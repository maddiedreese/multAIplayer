import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { MlsRelayMessage } from "@multaiplayer/protocol";
import type { WebSocket } from "ws";
import { createRelayMetrics } from "../src/observability.js";
import { createRelayStore, type RoomKey } from "../src/state.js";
import { createRelayFanout } from "../src/ws/fanout.js";

test("failed MLS persistence restores backlog and epoch", async () => {
  const { store, fanout, key } = setup(async () => {
    throw new Error("disk unavailable");
  });
  const retained = message("retained", "application", 0);
  store.setMlsBacklog(key, [retained]);
  await assert.rejects(fanout.publishMlsMessage(message("failed", "commit", 0)), /disk unavailable/);
  assert.deepEqual(store.getMlsBacklog(key), [retained]);
  assert.equal(store.getRoom("room-desktop")?.acceptedMlsEpoch, 0);
});

test("only the active host device may commit and stale commits rebase", async () => {
  const { store, fanout, key } = setup(async () => undefined);
  await assert.rejects(
    fanout.publishMlsMessage({ ...message("wrong", "commit", 0), senderDeviceId: "device-other" }),
    /active host device/
  );
  await fanout.publishMlsMessage(message("first", "commit", 0));
  await assert.rejects(fanout.publishMlsMessage(message("stale", "commit", 0)), /accepted epoch is 1/);
  assert.deepEqual(
    store.getMlsBacklog(key)?.map((item) => item.id),
    ["first"]
  );
});

test("queued publishes fail after room lifecycle changes without restoring durable activity", async () => {
  let writes = 0;
  const { store, key } = setup(async () => {
    writes += 1;
  });
  const fanout = fanoutFor(
    store,
    key,
    async () => {
      writes += 1;
    },
    async () => {
      writes += 1;
    },
    true,
    createRelayMetrics(),
    async () => {
      store.setRoom({ ...store.getRoom("room-desktop")!, archivedAt: new Date().toISOString() });
    }
  );

  await assert.rejects(fanout.publishMlsMessage(message("after-archive", "application", 0)), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "not_joined";
  });
  assert.equal(writes, 0);
  assert.equal(store.getMlsBacklog(key), undefined);
  assert.equal(store.acceptedMessageReceipts.size, 0);
});

test("queued publishes recheck the exact caller authorization after capacity reclamation", async () => {
  let authorized = true;
  let writes = 0;
  const { store, key } = setup(async () => {
    writes += 1;
  });
  const fanout = fanoutFor(
    store,
    key,
    async () => {
      writes += 1;
    },
    async () => {
      writes += 1;
    },
    true,
    createRelayMetrics(),
    async () => {
      authorized = false;
    }
  );

  await assert.rejects(
    fanout.publishMlsMessage(message("after-revocation", "application", 0), () => authorized),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "not_joined"
  );
  assert.equal(writes, 0);
  assert.equal(store.getMlsBacklog(key), undefined);
  assert.equal(store.acceptedMessageReceipts.size, 0);
});

test("workspace updates are sent only to current team members", () => {
  const store = createRelayStore();
  const team = { id: "team-core", name: "Core", members: 1 };
  store.setTeam(team);
  store.setTeamMembers(
    team.id,
    new Map([
      ["github:member", { teamId: team.id, userId: "github:member", role: "owner", joinedAt: new Date().toISOString() }]
    ])
  );
  const member = recordingSocket();
  const unrelated = recordingSocket();
  for (const [socket, userId] of [
    [member.socket, "github:member"],
    [unrelated.socket, "github:unrelated"]
  ] as const) {
    store.workspaceSockets.add(socket);
    store.sessions.set(socket, {
      socket,
      authSession: {
        sessionIdHash: "a".repeat(64),
        user: { id: userId, login: userId },
        expiresAt: Date.now() + 60_000
      },
      rateClientId: userId,
      subscribedTeamIds: new Set(),
      workspaceSubscribed: true
    });
  }

  fanoutFor(store, "team-core:room-desktop", async () => undefined).broadcastWorkspaceUpdated(team);

  assert.equal(member.sent.length, 1);
  assert.equal(unrelated.sent.length, 0);

  store.workspaceSockets.clear();
  const authDisabled = recordingSocket();
  store.workspaceSockets.add(authDisabled.socket);
  fanoutFor(store, "team-core:room-desktop", async () => undefined, undefined, false).broadcastWorkspaceUpdated(team);
  assert.equal(authDisabled.sent.length, 1);
});

test("identical retries acknowledge without rebroadcast while conflicting ids fail", async () => {
  let writes = 0;
  const { store, fanout, key } = setup(async () => {
    writes += 1;
  });
  const first = message("retry", "commit", 0);
  await fanout.publishMlsMessage(first);
  store.setMlsBacklog(key, []);
  const restarted = fanoutFor(store, key, async () => {
    writes += 1;
  });
  await restarted.publishMlsMessage({ ...first, createdAt: new Date(Date.now() + 1_000).toISOString() });
  assert.equal(writes, 1);
  await assert.rejects(restarted.publishMlsMessage({ ...first, mlsMessage: "AQ==" }), /already bound/);
});

test("application receipt acknowledges after epoch advance and backlog pruning", async () => {
  let applicationWrites = 0;
  const { store, fanout, key } = setup(
    async () => undefined,
    async () => {
      applicationWrites += 1;
    }
  );
  const application = message("application-retry", "application", 0);
  await fanout.publishMlsMessage(application);
  await fanout.publishMlsMessage(message("advance", "commit", 0));
  const { store: restartedStore } = setup(async () => undefined);
  restartedStore.setRoom(store.getRoom("room-desktop")!);
  for (const [id, receipt] of store.acceptedMessageReceipts) restartedStore.acceptedMessageReceipts.set(id, receipt);
  const restarted = fanoutFor(
    restartedStore,
    key,
    async () => undefined,
    async () => {
      applicationWrites += 1;
    }
  );
  await restarted.publishMlsMessage(application);
  assert.equal(applicationWrites, 1);
});

test("applications may arrive from the three retained epochs but fail distinctly after expiry", async () => {
  const { fanout } = setup(async () => undefined);
  await fanout.publishMlsMessage(message("advance-1", "commit", 0));
  await fanout.publishMlsMessage(message("late-at-one", "application", 0));
  await fanout.publishMlsMessage(message("advance-2", "commit", 1));
  await fanout.publishMlsMessage(message("late-at-two", "application", 0));
  await fanout.publishMlsMessage(message("advance-3", "commit", 2));
  await assert.rejects(
    fanout.publishMlsMessage(message("expired-at-three", "application", 0)),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "application_epoch_expired"
  );
  await assert.rejects(fanout.publishMlsMessage(message("future", "application", 4)), /ahead of accepted epoch 3/);
  await assert.rejects(fanout.publishMlsMessage(message("old-commit", "commit", 2)), /stale/);
});

test("successful publishes record queue-to-fanout and WebSocket send latency", async () => {
  const store = createRelayStore();
  const key = "team-core:room-desktop" as RoomKey;
  store.setTeam({ id: "team-core", name: "Core", members: 1 });
  store.setRoom({
    id: "room-desktop",
    teamId: "team-core",
    acceptedMlsEpoch: 0,
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "device-host",
    hostStatus: "active"
  } as never);
  const metrics = createRelayMetrics();
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(_payload: string, callback: () => void) {
      callback();
    }
  } as unknown as WebSocket;
  store.roomSockets.set(key, new Set([socket]));
  const fanout = fanoutFor(
    store,
    key,
    async () => undefined,
    async () => undefined,
    true,
    metrics
  );

  await fanout.publishMlsMessage(message("observed", "application", 0));

  const snapshot = metrics.snapshot(1);
  assert.equal(snapshot.publishToFanoutDurationSeconds.count, 1);
  assert.equal(snapshot.webSocketSendDurationSeconds.count, 1);
});

test("application floods cannot evict Commit or another sender's durable retry receipt", async () => {
  const { store, fanout, key } = setup(async () => undefined);
  const commit = message("durable-commit", "commit", 0);
  const otherSender = {
    ...message("other-sender", "application", 1),
    senderUserId: "github:other",
    senderDeviceId: "device-other"
  };
  await fanout.publishMlsMessage(commit);
  await fanout.publishMlsMessage(otherSender);
  for (let index = 0; index < 4_097; index += 1) {
    await fanout.publishMlsMessage({
      ...message(`flood-${index}`, "application", 1),
      createdAt: new Date(index).toISOString()
    });
  }
  const { store: restartedStore } = setup(async () => undefined);
  restartedStore.setRoom(store.getRoom("room-desktop")!);
  for (const [id, receipt] of store.acceptedMessageReceipts) restartedStore.acceptedMessageReceipts.set(id, receipt);
  const restarted = fanoutFor(restartedStore, key, async () => {
    throw new Error("exact retries must not persist again");
  });
  await restarted.publishMlsMessage({ ...commit, createdAt: new Date(Date.now() + 1_000).toISOString() });
  await restarted.publishMlsMessage(otherSender);
  assert.equal(
    Array.from(restartedStore.acceptedMessageReceipts.values()).filter(
      (receipt) => receipt.messageType === "application" && receipt.senderUserId === "github:host"
    ).length,
    4_096
  );
});

test("host transfer requires an outgoing-host signature bound to exact commit and next leaf", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const { store, fanout } = setup(async () => undefined);
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  store.setDevice({
    userId: "github:host",
    deviceId: "device-host",
    displayName: "Host",
    signaturePublicKey: spki,
    signatureKeyFingerprint: fingerprint(spki),
    hpkePublicKey: spki,
    hpkeKeyFingerprint: fingerprint(spki),
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });
  store.setDevice({
    userId: "github:next",
    deviceId: "device-next",
    displayName: "Next",
    signaturePublicKey: spki,
    signatureKeyFingerprint: fingerprint(spki),
    hpkePublicKey: spki,
    hpkeKeyFingerprint: fingerprint(spki),
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });
  store.setTeamMembers(
    "team-core",
    new Map([
      [
        "github:next",
        { teamId: "team-core", userId: "github:next", role: "member", joinedAt: new Date().toISOString() }
      ]
    ])
  );
  const commit = message("outer", "commit", 0);
  const authorization = {
    version: 2 as const,
    transferId: "offer-1",
    roomId: commit.roomId,
    commitMessageId: createHash("sha256").update(Buffer.from(commit.mlsMessage, "base64")).digest("hex"),
    parentEpoch: 0,
    outgoingHostUserId: commit.senderUserId,
    outgoingHostDeviceId: commit.senderDeviceId,
    nextHostUserId: "github:next",
    nextHostDeviceId: "device-next",
    nextHostLeaf: 1
  };
  const signatureDer = sign(
    "sha256",
    Buffer.concat([
      Buffer.from("multaiplayer:host-transfer-authorization:v2\0"),
      Buffer.from(JSON.stringify(authorization))
    ]),
    privateKey
  ).toString("base64");
  const handoff = {
    ...commit,
    commitEffect: "host_handoff" as const,
    nextHostUserId: "github:next",
    nextHostDeviceId: "device-next",
    hostTransferAuthorization: { ...authorization, signatureDer, publicKeySpkiDer: spki }
  };
  await fanout.publishMlsMessage(handoff);
  assert.equal(store.getRoom("room-desktop")?.hostUserId, "github:next");
  const { store: retryStore } = setup(async () => undefined);
  retryStore.setRoom(store.getRoom("room-desktop")!);
  for (const [id, receipt] of store.acceptedMessageReceipts) retryStore.acceptedMessageReceipts.set(id, receipt);
  await fanoutFor(retryStore, "team-core:room-desktop", async () => undefined).publishMlsMessage({
    ...handoff,
    createdAt: new Date(Date.now() + 1_000).toISOString()
  });
  const { store: rejectedStore, fanout: rejected } = setup(async () => undefined);
  rejectedStore.setDevice(store.getDevice("github:host", "device-host")!);
  rejectedStore.setDevice(store.getDevice("github:next", "device-next")!);
  rejectedStore.setTeamMembers("team-core", store.getTeamMembers("team-core")!);
  await assert.rejects(
    rejected.publishMlsMessage({ ...handoff, nextHostDeviceId: "different-device" }),
    /authorization/
  );
});

function setup(saveMlsCommit: () => Promise<void>, saveMlsMessage: () => Promise<void> = async () => undefined) {
  const store = createRelayStore(),
    key = "team-core:room-desktop" as RoomKey;
  store.setTeam({ id: "team-core", name: "Core", members: 1 });
  store.setRoom({
    id: "room-desktop",
    teamId: "team-core",
    acceptedMlsEpoch: 0,
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "device-host",
    hostStatus: "active"
  } as never);
  const fanout = fanoutFor(store, key, saveMlsCommit, saveMlsMessage);
  return { store, fanout, key };
}
function fanoutFor(
  store: ReturnType<typeof createRelayStore>,
  key: RoomKey,
  saveMlsCommit: () => Promise<void>,
  saveMlsMessage: () => Promise<void> = async () => undefined,
  mutationsRequireAuth = true,
  metrics = createRelayMetrics(),
  reclaimDurableCapacity?: () => Promise<void>
) {
  const fanout = createRelayFanout({
    store,
    roomSockets: store.roomSockets,
    teamSockets: store.teamSockets,
    workspaceSockets: store.workspaceSockets,
    sessions: store.sessions,
    roomPresence: store.roomPresence,
    mutationsRequireAuth,
    metrics,
    roomKey: () => key,
    pruneMlsBacklog: (items) => items,
    ...(reclaimDurableCapacity ? { reclaimDurableCapacity } : {}),
    saveMlsMessage,
    saveMlsCommit,
    teamRecordForUser: (team) => team
  });
  return {
    ...fanout,
    publishMlsMessage: (message: MlsRelayMessage, remainsAuthorized: () => boolean = () => true) =>
      fanout.publishMlsMessage(message, remainsAuthorized)
  };
}

function recordingSocket() {
  const sent: string[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(payload: string, callback: () => void) {
      sent.push(payload);
      callback();
    }
  } as unknown as WebSocket;
  return { socket, sent };
}
function message(id: string, messageType: MlsRelayMessage["messageType"], epochHint: number): MlsRelayMessage {
  return {
    id,
    teamId: "team-core",
    roomId: "room-desktop",
    senderUserId: "github:host",
    senderDeviceId: "device-host",
    createdAt: new Date().toISOString(),
    messageType,
    epochHint,
    mlsMessage: "AA=="
  };
}
function fingerprint(encoded: string): string {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{4}/g)!.join(":")}`;
}

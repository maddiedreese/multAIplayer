import test from "node:test";
import express from "express";
import {
  acquireDurableQuotaTransaction,
  reserveDurableQuota,
  rollbackDurableQuota,
  type DurableQuota
} from "../src/auth/account-quotas.js";
import { registerAttachmentRoutes } from "../src/http/attachments.js";
import { createRelayStore } from "../src/state.js";
import { assert, createDebugSession, startRelayWithWorkspace } from "./support/relay.js";

test("durable quota reservations serialize the exact boundary and roll back failed persistence", () => {
  const store = createRelayStore();
  const first = reserveDurableQuota({
    store,
    quota: "attachment_upload_bytes",
    userId: "github:user",
    amount: 60,
    limit: 100,
    resetAt: 2_000,
    now: 1_000
  });
  assert.equal(first.allowed, true);
  const boundary = reserveDurableQuota({
    store,
    quota: "attachment_upload_bytes",
    userId: "github:user",
    amount: 40,
    limit: 100,
    resetAt: 2_000,
    now: 1_000
  });
  assert.equal(boundary.allowed, true);
  const rejected = reserveDurableQuota({
    store,
    quota: "attachment_upload_bytes",
    userId: "github:user",
    amount: 1,
    limit: 100,
    resetAt: 2_000,
    now: 1_000
  });
  assert.deepEqual(rejected, { allowed: false, used: 100, resetAt: 2_000 });
  if (boundary.allowed) rollbackDurableQuota(store, boundary);
  assert.equal(store.accountQuotaRecords.get("attachment_upload_bytes:github:user")?.used, 60);
});

test("expired durable windows reset instead of carrying usage forward", () => {
  const store = createRelayStore();
  store.accountQuotaRecords.set("daily_team_creations:github:user", {
    key: "daily_team_creations:github:user",
    userId: "github:user",
    quota: "daily_team_creations",
    used: 25,
    resetAt: 999
  });
  const next = reserveDurableQuota({
    store,
    quota: "daily_team_creations",
    userId: "github:user",
    limit: 25,
    resetAt: 2_000,
    now: 1_000
  });
  assert.equal(next.allowed, true);
  assert.equal(store.accountQuotaRecords.get("daily_team_creations:github:user")?.used, 1);
});

test("rolling back an older reservation subtracts only its contribution", () => {
  for (const [quota, amount] of [
    ["daily_team_creations", 1],
    ["daily_room_creations", 1],
    ["attachment_upload_bytes", 40]
  ] as const) {
    const store = createRelayStore();
    const first = reserveDurableQuota({
      store,
      quota,
      userId: "github:user",
      amount,
      limit: amount * 3,
      resetAt: 2_000,
      now: 1_000
    });
    const newer = reserveDurableQuota({
      store,
      quota,
      userId: "github:user",
      amount,
      limit: amount * 3,
      resetAt: 2_000,
      now: 1_000
    });
    assert.equal(first.allowed, true);
    assert.equal(newer.allowed, true);
    if (!first.allowed || !newer.allowed) continue;
    rollbackDurableQuota(store, first);
    assert.equal(store.accountQuotaRecords.get(`${quota}:github:user`)?.used, amount);
    rollbackDurableQuota(store, newer);
    assert.equal(store.accountQuotaRecords.has(`${quota}:github:user`), false);
  }
});

test("quota transactions wait for failed persistence rollback before taking the next snapshot", async (t) => {
  for (const [quota, amount] of [
    ["daily_team_creations", 1],
    ["daily_room_creations", 1],
    ["attachment_upload_bytes", 40]
  ] as const satisfies ReadonlyArray<readonly [DurableQuota, number]>) {
    await t.test(quota, async () => {
      const store = createRelayStore();
      const snapshots: Array<Record<string, unknown>> = [];
      let rejectFirstWrite!: (error: Error) => void;
      let firstWriteEntered!: () => void;
      const firstWrite = new Promise<void>((resolve) => {
        firstWriteEntered = resolve;
      });
      const persistence = {
        async save(state: Record<string, unknown>) {
          snapshots.push(structuredClone(state));
          if (snapshots.length === 1) {
            firstWriteEntered();
            await new Promise<void>((_resolve, reject) => {
              rejectFirstWrite = reject;
            });
          }
        }
      };
      const state = () => ({
        version: 1,
        accountQuotaRecords: Array.from(store.accountQuotaRecords.values())
      });
      const releaseFirst = await acquireDurableQuotaTransaction(store);
      const failedReservation = reserveDurableQuota({
        store,
        quota,
        userId: "github:user",
        amount,
        limit: amount * 3,
        resetAt: 2_000,
        now: 1_000
      });
      assert.equal(failedReservation.allowed, true);
      const failedSave = persistence.save(state());
      await firstWrite;

      const successfulTransaction = (async () => {
        const release = await acquireDurableQuotaTransaction(store);
        try {
          const reservation = reserveDurableQuota({
            store,
            quota,
            userId: "github:user",
            amount,
            limit: amount * 3,
            resetAt: 2_000,
            now: 1_000
          });
          assert.equal(reservation.allowed, true);
          await persistence.save(state());
        } finally {
          release();
        }
      })();
      await Promise.resolve();
      assert.equal(snapshots.length, 1);

      rejectFirstWrite(new Error("injected persistence failure"));
      await assert.rejects(failedSave, /injected persistence failure/);
      if (failedReservation.allowed) rollbackDurableQuota(store, failedReservation);
      releaseFirst();
      await successfulTransaction;

      assert.equal(snapshots.length, 2);
      const persistedQuotas = snapshots[1].accountQuotaRecords as Array<{ quota: DurableQuota; used: number }>;
      assert.deepEqual(
        persistedQuotas.map(({ quota: type, used }) => ({ type, used })),
        [{ type: quota, used: amount }]
      );
    });
  }
});

test("daily team and room quotas survive a SQLite relay restart", async () => {
  const env = {
    MULTAIPLAYER_RELAY_STORAGE: "sqlite",
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP: "1",
    MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP: "1"
  };
  const relay = await startRelayWithWorkspace(env);
  let restarted: Awaited<ReturnType<typeof startRelayWithWorkspace>> | null = null;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "quota");
    const headers = { "content-type": "application/json", cookie };
    assert.equal(
      (await fetch(`${relay.baseUrl}/teams`, { method: "POST", headers, body: JSON.stringify({ name: "Quota" }) }))
        .status,
      201
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/rooms`, {
          method: "POST",
          headers,
          body: JSON.stringify({ teamId: "team-core", name: "Quota" })
        })
      ).status,
      201
    );
    await relay.close({ preserveData: true });
    restarted = await startRelayWithWorkspace(env, undefined, relay.dataPath);
    for (const [path, body] of [
      ["/teams", { name: "Blocked" }],
      ["/rooms", { teamId: "team-core", name: "Blocked" }]
    ] as const) {
      const response = await fetch(`${restarted.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("retry-after")) > 0);
    }
  } finally {
    if (restarted) await restarted.close();
    else await relay.close();
  }
});

test("simultaneous team creations serialize through the single SQLite writer", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_STORAGE: "sqlite",
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP: "1"
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "quota-race");
    const create = (name: string) =>
      fetch(`${relay.baseUrl}/teams`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name })
      });
    const responses = await Promise.all([create("First"), create("Second")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
  } finally {
    await relay.close();
  }
});

test("live invite ceilings are global to an account", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_RELAY_LIVE_INVITE_CAP_USER: "1"
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "invite-quota");
    const create = () =>
      fetch(`${relay.baseUrl}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
      });
    assert.equal((await create()).status, 201);
    const rejected = await create();
    assert.equal(rejected.status, 429);
    assert.equal(((await rejected.json()) as { quota: { type: string } }).quota.type, "live_invites_per_user");
  } finally {
    await relay.close();
  }
});

test("attachment upload byte windows survive a SQLite relay restart", async () => {
  const env = {
    MULTAIPLAYER_RELAY_STORAGE: "sqlite",
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "40",
    MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES: "200",
    MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW: "100"
  };
  const relay = await startRelayWithWorkspace(env);
  let restarted: Awaited<ReturnType<typeof startRelayWithWorkspace>> | null = null;
  const sealedBlob = JSON.stringify({
    version: 1,
    epoch: 0,
    nonce: Buffer.alloc(12, 1).toString("base64"),
    ciphertext: Buffer.from("opaque").toString("base64")
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "blob-quota");
    const upload = (baseUrl: string, blobId: string, size: number) =>
      fetch(`${baseUrl}/attachment-blobs`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          blobId,
          teamId: "team-core",
          roomId: "room-desktop",
          name: "opaque",
          type: "file",
          size,
          epoch: 0,
          sealedBlob
        })
      });
    assert.equal((await upload(relay.baseUrl, "quota-blob-one", 40)).status, 201);
    await relay.close({ preserveData: true });
    restarted = await startRelayWithWorkspace(env, undefined, relay.dataPath);
    const rejected = await upload(restarted.baseUrl, "quota-blob-two", 25);
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.headers.get("retry-after")) > 0);
  } finally {
    if (restarted) await restarted.close();
    else await relay.close();
  }
});

test("attachment persistence failure rolls back both blob and byte reservation", async () => {
  const app = express();
  app.use(express.json());
  const store = createRelayStore();
  store.setTeam({ id: "team", name: "Team", members: 1 });
  store.setRoom({
    id: "room",
    teamId: "team",
    name: "Room",
    host: "User",
    hostUserId: "github:user",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    mode: { chat: true, code: true, workspace: true, browser: false },
    browserProfilePersistent: false,
    unread: 0
  });
  registerAttachmentRoutes({
    app,
    store,
    attachmentBlobMaxBytes: 64,
    attachmentBlobLiveQuotaBytes: 128,
    attachmentBlobTeamLiveQuotaBytes: 256,
    attachmentBlobUploadBytesPerWindow: 128,
    attachmentBlobUploadWindowMs: 60_000,
    attachmentBlobTtlDays: 30,
    maxAttachmentBlobNameChars: 512,
    maxAttachmentBlobTypeChars: 160,
    getAuthSession: () => ({
      sessionIdHash: "hash",
      user: { id: "github:user", login: "user" },
      expiresAt: Date.now() + 60_000
    }),
    allowRead: () => true,
    allowMutation: () => true,
    canAccessRoom: () => true,
    scheduleStoreSave: () => undefined,
    saveRelayStore: async () => {
      throw new Error("injected persistence failure");
    },
    normalizeMetadataText: (value) => (typeof value === "string" && value ? value : null),
    maxCiphertextCharactersForBlob: () => 10_000,
    isExpiredAttachmentBlob: () => false
  });
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blobId: "rollback-blob",
        teamId: "team",
        roomId: "room",
        name: "opaque",
        type: "file",
        size: 32,
        epoch: 0,
        sealedBlob: JSON.stringify({
          version: 1,
          epoch: 0,
          nonce: Buffer.alloc(12, 1).toString("base64"),
          ciphertext: "AA=="
        })
      })
    });
    assert.equal(response.status, 503);
    assert.equal(store.attachmentBlobs.size, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

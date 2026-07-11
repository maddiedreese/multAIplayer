import assert from "node:assert/strict";
import test from "node:test";
import { createRelayMetrics } from "../src/observability.js";
import { createRelayStore, type RoomKey } from "../src/state.js";
import { createRelayFanout } from "../src/ws/fanout.js";
import { testEnvelope } from "./support/relay.js";

test("failed envelope persistence restores the exact prior backlog and does not count publication", async () => {
  const store = createRelayStore();
  const key = "team-core\nroom-desktop" as RoomKey;
  const retained = testEnvelope({ id: "envelope-retained" });
  const rejected = testEnvelope({ id: "envelope-persistence-failed" });
  store.setEncryptedBacklog(key, [retained]);
  const metrics = createRelayMetrics();
  const fanout = createRelayFanout({
    store,
    roomSockets: store.roomSockets,
    teamSockets: store.teamSockets,
    workspaceSockets: store.workspaceSockets,
    sessions: store.sessions,
    roomPresence: store.roomPresence,
    metrics,
    roomKey: () => key,
    pruneEncryptedBacklog: (envelopes) => envelopes,
    addTeamMember: () => undefined,
    saveEncryptedEnvelope: async () => {
      throw new Error("disk unavailable");
    },
    saveRoomKeyTransition: async () => {
      throw new Error("disk unavailable");
    },
    roomEpochEnvelopeLimit: 1_000_000,
    teamRecordForUser: (team) => team
  });

  await assert.rejects(fanout.publishEnvelope(rejected), /disk unavailable/);
  assert.deepEqual(store.getEncryptedBacklog(key), [retained]);
  assert.equal(metrics.snapshot(0).envelopesPublishedTotal, 0);
});

test("room epoch compare-and-swap rejects competing transitions from the same epoch", async () => {
  const store = createRelayStore();
  const key = "team-core\nroom-desktop" as RoomKey;
  store.setRoom({ id: "room-desktop", teamId: "team-core" } as never);
  const first = { ...testEnvelope({ id: "rotation-first" }), kind: "room.key" as const, keyEpoch: 1 };
  const competing = { ...testEnvelope({ id: "rotation-competing" }), kind: "room.key" as const, keyEpoch: 1 };
  let releasePersistence!: () => void;
  const persistenceBarrier = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const fanout = createRelayFanout({
    store,
    roomSockets: store.roomSockets,
    teamSockets: store.teamSockets,
    workspaceSockets: store.workspaceSockets,
    sessions: store.sessions,
    roomPresence: store.roomPresence,
    metrics: createRelayMetrics(),
    roomKey: () => key,
    pruneEncryptedBacklog: (envelopes) => envelopes,
    addTeamMember: () => undefined,
    saveEncryptedEnvelope: async () => persistenceBarrier,
    saveRoomKeyTransition: async () => persistenceBarrier,
    teamRecordForUser: (team) => team
  });

  const accepted = fanout.publishEnvelope(first);
  const rejectedCompeting = fanout.publishEnvelope(competing);
  releasePersistence();
  await accepted;
  await assert.rejects(rejectedCompeting, /does not match accepted epoch 2/);
  assert.deepEqual(
    store.getEncryptedBacklog(key)?.map((envelope) => envelope.id),
    [first.id]
  );
  assert.equal(store.getRoom("room-desktop")?.keyEpoch, 2);

  // Simulate retention pruning followed by process restart: authoritative room metadata, not backlog, drives epoch CAS.
  store.setEncryptedBacklog(key, []);
  const restarted = createRelayFanout({
    store,
    roomSockets: store.roomSockets,
    teamSockets: store.teamSockets,
    workspaceSockets: store.workspaceSockets,
    sessions: store.sessions,
    roomPresence: store.roomPresence,
    metrics: createRelayMetrics(),
    roomKey: () => key,
    pruneEncryptedBacklog: (envelopes) => envelopes,
    addTeamMember: () => undefined,
    saveEncryptedEnvelope: async () => undefined,
    saveRoomKeyTransition: async () => undefined,
    roomEpochEnvelopeLimit: 1_000_000,
    teamRecordForUser: (team) => team
  });
  await assert.doesNotReject(
    restarted.publishEnvelope({ ...testEnvelope({ id: "epoch-two-after-restart" }), keyEpoch: 2 })
  );
});

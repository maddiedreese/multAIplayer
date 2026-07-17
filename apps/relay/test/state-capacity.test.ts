import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createRelayStore, RelayStoreByteCapacityError, RelayStoreCapacityError } from "../src/state.js";

test("durable relay state fails loudly at its configured entry ceiling", () => {
  const store = createRelayStore(2);
  store.invites.set("invite-a", {} as never);
  store.rooms.set("room-a", {} as never);

  assert.throws(() => store.devices.set("user:device", {} as never), RelayStoreCapacityError);

  store.invites.delete("invite-a");
  assert.doesNotThrow(() => store.devices.set("user:device", {} as never));
});

test("replacing durable entries does not consume additional capacity", () => {
  const store = createRelayStore(1);
  store.invites.set("invite-a", {} as never);
  assert.doesNotThrow(() => store.invites.set("invite-a", { replacement: true } as never));
});

test("one team's durable-entry ceiling preserves global capacity for another team", () => {
  const store = createRelayStore(100, 3);
  store.setTeam({ id: "team-a", name: "A", members: 1 });
  store.setTeamMembers(
    "team-a",
    new Map([["user-a", { teamId: "team-a", userId: "user-a", role: "owner", joinedAt: new Date().toISOString() }]])
  );

  assert.throws(
    () => store.setRoom({ id: "room-a", teamId: "team-a" } as never),
    (error: unknown) => error instanceof RelayStoreCapacityError && error.teamId === "team-a"
  );
  assert.doesNotThrow(() => store.setTeam({ id: "team-b", name: "B", members: 0 }));
});

test("consumed KeyPackage tombstones use their originating team's durable-entry budget", () => {
  const store = createRelayStore(100, 4);
  store.setTeam({ id: "team-a", name: "A", members: 1 });
  store.setTeamMembers(
    "team-a",
    new Map([["user-a", { teamId: "team-a", userId: "user-a", role: "owner", joinedAt: new Date().toISOString() }]])
  );
  store.consumedKeyPackages.set(`sha256:${"1".repeat(64)}`, {
    keyPackageHash: `sha256:${"1".repeat(64)}`,
    teamId: "team-a",
    consumedAt: new Date().toISOString()
  });

  assert.throws(
    () =>
      store.consumedKeyPackages.set(`sha256:${"2".repeat(64)}`, {
        keyPackageHash: `sha256:${"2".repeat(64)}`,
        teamId: "team-a",
        consumedAt: new Date().toISOString()
      }),
    (error: unknown) => error instanceof RelayStoreCapacityError && error.teamId === "team-a"
  );
  assert.doesNotThrow(() =>
    store.consumedKeyPackages.set(`sha256:${"3".repeat(64)}`, {
      keyPackageHash: `sha256:${"3".repeat(64)}`,
      consumedAt: new Date().toISOString()
    })
  );
});

test("MLS backlog bytes are bounded by room, team, and relay scope without corrupting accounting", () => {
  const store = createRelayStore(100, 100, {
    mlsBacklog: { global: 1_200, perTeam: 800, perRoom: 600 },
    attachmentBlobs: { global: 1_000, perTeam: 1_000 }
  });
  const message = (id: string, teamId: string, roomId: string, payloadBytes: number) => ({
    id,
    teamId,
    roomId,
    senderUserId: "user",
    senderDeviceId: "device",
    createdAt: new Date(0).toISOString(),
    messageType: "application" as const,
    epochHint: 0,
    mlsMessage: "x".repeat(payloadBytes)
  });
  const first = [message("one", "team-a", "room-a", 100)];
  store.setMlsBacklog("team-a:room-a", first);
  const firstUsage = store.retainedByteUsage().mlsBacklogBytes;

  assert.throws(
    () => store.setMlsBacklog("team-a:room-a", [message("large", "team-a", "room-a", 500)]),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "room"
  );
  assert.deepEqual(store.getMlsBacklog("team-a:room-a"), first);
  assert.equal(store.retainedByteUsage().mlsBacklogBytes, firstUsage);

  assert.throws(
    () => store.setMlsBacklog("team-a:room-b", [message("two", "team-a", "room-b", 350)]),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "team"
  );
  assert.doesNotThrow(() => store.setMlsBacklog("team-b:room-b", [message("three", "team-b", "room-b", 350)]));
  assert.throws(
    () => store.setMlsBacklog("team-c:room-c", [message("four", "team-c", "room-c", 350)]),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "relay"
  );
});

test("attachment ciphertext bytes are bounded per team and globally", () => {
  const store = createRelayStore(100, 100, {
    mlsBacklog: { global: 1_000, perTeam: 1_000, perRoom: 1_000 },
    attachmentBlobs: { global: 12, perTeam: 8 }
  });
  const blob = (id: string, teamId: string, sealedBlob: string) => ({ id, teamId, roomId: "room", sealedBlob });
  store.setAttachmentBlob(blob("one", "team-a", "12345678") as never);
  assert.throws(
    () => store.setAttachmentBlob(blob("two", "team-a", "1") as never),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "team"
  );
  store.setAttachmentBlob(blob("two", "team-b", "1234") as never);
  assert.equal(store.retainedByteUsage().attachmentBlobBytes, 12);
  assert.throws(
    () => store.setAttachmentBlob(blob("three", "team-c", "1") as never),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "relay"
  );
  store.deleteAttachmentBlob("one");
  assert.doesNotThrow(() => store.setAttachmentBlob(blob("three", "team-c", "12345678") as never));
});

test("cross-team replacements validate net bytes and roll back both scopes atomically", () => {
  const store = createRelayStore(100, 100, {
    mlsBacklog: { global: 1_000, perTeam: 1_000, perRoom: 1_000 },
    attachmentBlobs: { global: 10, perTeam: 6 }
  });
  const original = { id: "blob", teamId: "team-a", roomId: "room", sealedBlob: "123456" };
  store.setAttachmentBlob(original as never);
  assert.throws(
    () => store.setAttachmentBlob({ ...original, teamId: "team-b", sealedBlob: "1234567" } as never),
    (error: unknown) => error instanceof RelayStoreByteCapacityError && error.scope === "team"
  );
  assert.equal(store.getAttachmentBlob("blob")?.teamId, "team-a");
  assert.equal(store.retainedByteUsage().attachmentBlobBytes, 6);
  assert.doesNotThrow(() => store.setAttachmentBlob({ ...original, teamId: "team-b", sealedBlob: "12345" } as never));
  assert.equal(store.getAttachmentBlob("blob")?.teamId, "team-b");
  assert.equal(store.retainedByteUsage().attachmentBlobBytes, 5);
});

test("retained byte accounting equals the exact live ciphertext set across arbitrary replacements and deletes", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          operation: fc.constantFrom("set", "delete"),
          id: fc.integer({ min: 0, max: 8 }),
          team: fc.integer({ min: 0, max: 3 }),
          ciphertext: fc.string({ maxLength: 256 })
        }),
        { maxLength: 200 }
      ),
      (operations) => {
        const store = createRelayStore(10_000, 10_000, {
          mlsBacklog: { global: 1_000_000, perTeam: 1_000_000, perRoom: 1_000_000 },
          attachmentBlobs: { global: 1_000_000, perTeam: 1_000_000 }
        });
        const expected = new Map<string, string>();
        for (const operation of operations) {
          const id = `blob-${operation.id}`;
          if (operation.operation === "delete") {
            store.deleteAttachmentBlob(id);
            expected.delete(id);
          } else {
            store.setAttachmentBlob({
              id,
              teamId: `team-${operation.team}`,
              roomId: "room",
              sealedBlob: operation.ciphertext
            } as never);
            expected.set(id, operation.ciphertext);
          }
          const expectedBytes = Array.from(expected.values()).reduce(
            (total, ciphertext) => total + Buffer.byteLength(ciphertext, "utf8"),
            0
          );
          assert.equal(store.retainedByteUsage().attachmentBlobBytes, expectedBytes);
        }
      }
    ),
    { numRuns: 100 }
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { createRelayStoreCodec, type StoredRelayState } from "../src/store-codec.js";
import { InMemoryRelayStore } from "../src/state.js";

const fixedNow = Date.parse("2026-07-11T12:00:00.000Z");

function codec(store = new InMemoryRelayStore()) {
  return {
    store,
    codec: createRelayStoreCodec({
      store,
      attachmentBlobMaxBytes: 1_000_000,
      maxAttachmentBlobIdChars: 128,
      maxAttachmentBlobNameChars: 255,
      maxAttachmentBlobTypeChars: 128,
      maxCodexModelChars: 128,
      maxDeviceIdChars: 128,
      maxDisplayNameChars: 128,
      maxEnvelopeIdChars: 128,
      maxEnvelopeNonceChars: 128,
      maxHostNameChars: 128,
      maxPublicKeyFingerprintChars: 255,
      maxPublicKeyJwkChars: 2_048,
      maxRoomIdChars: 128,
      maxRoomNameChars: 128,
      maxRoomProjectPathChars: 1_024,
      maxTeamIdChars: 128,
      maxTeamNameChars: 128,
      maxUserIdChars: 128,
      isAllowedEnvelopePayload: () => true,
      normalizeStoredAuthSession: () => null,
      pruneEncryptedBacklog: (envelopes) => envelopes,
      storedAuthSessions: () => [],
      now: () => fixedNow
    })
  };
}

const safePart = fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}$/);
interface GeneratedState {
  teamPart: string;
  roomPart: string;
  teamName: string;
  roomName: string;
  members: number;
  unread: number;
  keyEpoch: number;
  epochEnvelopeCount: number;
}
const storedState: fc.Arbitrary<GeneratedState> = fc.record({
  teamPart: safePart,
  roomPart: safePart,
  teamName: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
  roomName: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
  members: fc.nat({ max: 10_000 }),
  unread: fc.nat({ max: 10_000 }),
  keyEpoch: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  epochEnvelopeCount: fc.nat({ max: Number.MAX_SAFE_INTEGER })
});

function input(value: GeneratedState): Record<string, unknown> {
  const teamId = `team-${value.teamPart}`;
  const roomId = `room-${value.roomPart}`;
  return {
    version: 1,
    savedAt: "2020-01-01T00:00:00.000Z",
    teams: [{ id: teamId, name: value.teamName, members: value.members }],
    rooms: [
      {
        id: roomId,
        teamId,
        name: value.roomName,
        projectPath: "/repo",
        host: "No host",
        hostStatus: "offline",
        unread: value.unread,
        keyEpoch: value.keyEpoch,
        epochEnvelopeCount: value.epochEnvelopeCount
      }
    ],
    invites: [],
    encryptedBacklog: []
  };
}

function semantic(state: StoredRelayState): Omit<StoredRelayState, "savedAt"> {
  const { savedAt: _, ...rest } = state;
  return rest;
}

test("relay store codec round-trips normalized generated states idempotently", () => {
  fc.assert(
    fc.property(storedState, (value) => {
      const first = codec();
      first.codec.applyStoredRelayState(input(value));
      const encoded = first.codec.toStoredRelayState();
      assert.equal(encoded.savedAt, "2026-07-11T12:00:00.000Z");

      const second = codec();
      second.codec.applyStoredRelayState(encoded);
      assert.deepEqual(semantic(second.codec.toStoredRelayState()), semantic(encoded));
    }),
    { numRuns: 500 }
  );
});

test("malformed generated records are isolated from valid store records", () => {
  fc.assert(
    fc.property(storedState, fc.jsonValue(), (value, malformed) => {
      const { store, codec: storeCodec } = codec();
      const valid = input(value);
      storeCodec.applyStoredRelayState({
        ...valid,
        teams: [malformed, ...(valid.teams as unknown[])],
        rooms: [...(valid.rooms as unknown[]), malformed]
      });
      assert.equal(store.teams.size, 1);
      assert.equal(store.rooms.size, 1);
    }),
    { numRuns: 500 }
  );
});

test("expiry and pruning use the injected clock", () => {
  const { store, codec: storeCodec } = codec();
  store.authSessions.set("expired", {
    accessToken: "secret",
    user: { id: "user", login: "user" },
    expiresAt: fixedNow
  });
  store.authSessions.set("active", {
    accessToken: "secret",
    user: { id: "user", login: "user" },
    expiresAt: fixedNow + 1
  });
  storeCodec.pruneExpiredRelayState();
  assert.equal(store.authSessions.has("expired"), false);
  assert.equal(store.authSessions.has("active"), true);
});

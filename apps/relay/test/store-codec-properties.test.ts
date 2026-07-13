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
      maxHostNameChars: 128,
      maxMlsMessageChars: 1_400_000,
      maxPublicKeyFingerprintChars: 255,
      maxPublicKeyJwkChars: 2_048,
      maxRoomIdChars: 128,
      maxRoomNameChars: 128,
      maxRoomProjectPathChars: 1_024,
      maxTeamIdChars: 128,
      maxTeamNameChars: 128,
      maxUserIdChars: 128,
      normalizeStoredAuthSession: () => null,
      pruneMlsBacklog: (messages) => messages,
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

test("arbitrary decoded store documents never escape codec normalization", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 10 })), (document) => {
      const first = codec();
      assert.doesNotThrow(() => first.codec.applyStoredRelayState(document));
      const normalized = first.codec.toStoredRelayState();
      const second = codec();
      assert.doesNotThrow(() => second.codec.applyStoredRelayState(normalized));
      assert.deepEqual(semantic(second.codec.toStoredRelayState()), semantic(normalized));
    }),
    { numRuns: 2_000 }
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

test("startup normalization discards non-canonical opaque encodings", () => {
  const { store, codec: storeCodec } = codec();
  const createdAt = "2026-07-11T11:00:00.000Z";
  storeCodec.applyStoredRelayState({
    version: 1,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [
      {
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop",
        projectPath: "/repo",
        host: "No host",
        hostStatus: "offline",
        unread: 0
      }
    ],
    invites: [],
    teamMembers: [],
    devices: [
      {
        userId: "github:test",
        deviceId: "device-test",
        displayName: "Test",
        signaturePublicKey: "AQ==",
        signatureKeyFingerprint: "AA",
        hpkePublicKey: "AQ==",
        hpkeKeyFingerprint: "BB",
        registeredAt: createdAt,
        lastSeenAt: createdAt
      }
    ],
    keyPackages: [
      {
        id: "kp-bad",
        keyPackage: "AB==",
        keyPackageHash: `sha256:${"0".repeat(64)}`,
        ciphersuite: 2,
        userId: "github:test",
        deviceId: "device-test",
        credentialIdentity: "identity",
        createdAt
      }
    ],
    inviteRequests: [
      {
        requestId: "request-bad",
        inviteId: "invite-bad",
        requesterUserId: "github:test",
        requesterDeviceId: "device-test",
        keyPackageId: "kp-bad",
        keyPackageHash: `sha256:${"0".repeat(64)}`,
        sealedRequest: '{"version":1,"kem_id":16,"kdf_id":1,"aead_id":1,"encapsulated_key":[1],"ciphertext":[2]}\n',
        createdAt
      }
    ],
    inviteResponses: [
      {
        requestId: "request-bad",
        inviteId: "invite-bad",
        requesterUserId: "github:test",
        requesterDeviceId: "device-test",
        welcome: "AB==",
        createdAt
      }
    ],
    attachmentBlobs: [
      {
        id: "blob-bad",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "bad.bin",
        type: "application/octet-stream",
        size: 1,
        epoch: 0,
        sealedBlob: '{"version":1,"epoch":0,"nonce":"AB==","ciphertext":"AQ=="}',
        createdAt
      }
    ],
    mlsBacklog: [
      {
        key: "team-core:room-desktop",
        messages: [
          {
            id: "message-bad",
            teamId: "team-core",
            roomId: "room-desktop",
            senderUserId: "github:test",
            senderDeviceId: "device-test",
            createdAt,
            messageType: "application",
            epochHint: 0,
            mlsMessage: "AB=="
          }
        ]
      }
    ]
  });
  assert.equal(store.keyPackages.size, 0);
  assert.equal(store.inviteRequests.size, 0);
  assert.equal(store.inviteResponses.size, 0);
  assert.equal(store.attachmentBlobs.size, 0);
  assert.equal(store.mlsBacklog.size, 0);
});

test("startup normalization rejects corrupt invite anchors and retains bounded receipts", () => {
  const createdAt = "2026-07-11T11:00:00.000Z";
  const response = {
    requestId: "request-one",
    inviteId: "invite-one",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-joiner",
    keyPackageHash: `sha256:${"a".repeat(64)}`,
    status: "approved",
    responseBinding: {
      version: 3,
      phase: "response",
      inviteId: "invite-one",
      teamId: "team-core",
      roomId: "room-desktop",
      keyEpoch: 1,
      keyPackageHash: `sha256:${"a".repeat(64)}`,
      requestId: "request-one",
      requestNonce: "nonce-one",
      requesterUserId: "github:joiner",
      requesterDeviceId: "device-joiner",
      hostUserId: "github:host",
      hostDeviceId: "device-host",
      expiresAt: "2026-07-13T12:00:00.000Z",
      status: "approved",
      decidedAt: createdAt
    },
    responseMac: "AA==",
    welcome: "AA==",
    createdAt
  };
  const state = {
    version: 1,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core", members: 2 }],
    rooms: [
      {
        id: "room-desktop",
        teamId: "team-core",
        name: "Room",
        projectPath: "/",
        host: "Host",
        hostStatus: "active",
        unread: 0
      }
    ],
    invites: [
      {
        id: "invite-one",
        teamId: "team-core",
        roomId: "room-desktop",
        approvedUserId: "github:joiner",
        approvedDeviceId: "device-joiner",
        keyPackageHash: `sha256:${"a".repeat(64)}`,
        createdAt
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { userId: "github:host", role: "owner", joinedAt: createdAt },
          { userId: "github:joiner", role: "member", joinedAt: createdAt }
        ]
      }
    ],
    inviteResponses: [response],
    inviteAckReceipts: [
      {
        inviteId: "invite-old",
        requestId: "request-old",
        teamId: "team-core",
        requesterUserId: "github:joiner",
        requesterDeviceId: "device-joiner",
        keyPackageHash: `sha256:${"b".repeat(64)}`,
        status: "approved",
        acknowledgedAt: createdAt,
        expiresAt: "2026-07-13T12:00:00.000Z"
      }
    ],
    acceptedMessageReceipts: [
      {
        roomKey: "team-core:room-desktop",
        messageId: "message-one",
        messageType: "commit",
        senderUserId: "github:host",
        senderDeviceId: "device-host",
        parentEpoch: 1,
        digest: "c".repeat(64),
        acceptedAt: createdAt
      }
    ],
    mlsBacklog: []
  };
  const valid = codec();
  valid.codec.applyStoredRelayState(state);
  assert.equal(valid.store.inviteResponses.size, 1);
  assert.equal(valid.store.inviteAckReceipts.size, 1);
  assert.equal(valid.store.acceptedMessageReceipts.size, 1);

  const corrupt = codec();
  corrupt.codec.applyStoredRelayState({
    ...state,
    inviteResponses: [{ ...response, requesterDeviceId: "device-mismatch" }]
  });
  assert.equal(corrupt.store.inviteResponses.size, 0);
});

test("startup normalization preserves an offline room's reserved bootstrap host", () => {
  const { codec: relayCodec, store } = codec();
  relayCodec.applyStoredRelayState({
    version: 1,
    savedAt: "2026-07-12T12:00:00.000Z",
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [
      {
        id: "room-bootstrap",
        teamId: "team-core",
        name: "Bootstrap",
        projectPath: "/tmp/bootstrap",
        host: "Creator",
        hostUserId: "github:creator",
        hostStatus: "offline",
        unread: 0
      }
    ]
  });
  const room = store.getRoom("room-bootstrap");
  assert.equal(room?.host, "Creator");
  assert.equal(room?.hostUserId, "github:creator");
  assert.equal(room?.hostStatus, "offline");
  assert.equal(room?.activeHostDeviceId, undefined);
  assert.equal(room?.acceptedMlsEpoch, undefined);
});

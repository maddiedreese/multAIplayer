import assert from "node:assert/strict";
import { createECDH, createHash, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import fc from "fast-check";
import {
  AttachmentBlobRecord,
  DeviceRecord,
  InviteJoinRequestRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  MlsRelayMessage,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import { createRelayStoreCodec, type StoredRelayState } from "../src/store-codec.js";
import { createRelayAuthSessionPersistence } from "../src/auth/session.js";
import {
  StoredAcceptedMessageReceipt,
  StoredAccountQuotaRecord,
  StoredAccountRestriction,
  StoredDeletionLedgerEntry,
  StoredInviteAckReceipt
} from "../src/store-codec-normalizers.js";
import { InMemoryRelayStore } from "../src/state.js";

const fixedNow = Date.parse("2026-07-11T12:00:00.000Z");
const authSessionPersistence = createRelayAuthSessionPersistence({
  authSessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxDisplayNameChars: 128,
  maxRoomProjectPathChars: 1_024,
  maxUserIdChars: 128
});

function codec(
  store = new InMemoryRelayStore(),
  pruneMlsBacklog: (messages: MlsRelayMessage[]) => MlsRelayMessage[] = (messages) => messages
) {
  return {
    store,
    codec: createRelayStoreCodec({
      store,
      attachmentBlobMaxBytes: 1_000_000,
      maxAttachmentBlobIdChars: 128,
      maxAttachmentBlobNameChars: 255,
      maxAttachmentBlobTypeChars: 128,
      maxDeviceIdChars: 128,
      maxEnvelopeIdChars: 128,
      maxHostNameChars: 128,
      maxMlsMessageChars: 1_400_000,
      maxPublicKeyJwkChars: 2_048,
      maxRoomIdChars: 128,
      maxRoomNameChars: 128,
      maxTeamIdChars: 128,
      maxTeamNameChars: 128,
      maxUserIdChars: 128,
      normalizeStoredAuthSession: authSessionPersistence.normalizeStoredAuthSession,
      pruneMlsBacklog,
      storedAuthSessions: authSessionPersistence.storedAuthSessions,
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
}
const storedState: fc.Arbitrary<GeneratedState> = fc.record({
  teamPart: safePart,
  roomPart: safePart,
  teamName: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
  roomName: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
  members: fc.integer({ min: 1, max: 8 }),
  unread: fc.nat({ max: 10_000 })
});

function currentRoom(overrides: Partial<RoomRecord> & Pick<RoomRecord, "id" | "teamId" | "name">): RoomRecord {
  return {
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    mode: { chat: true, code: true, workspace: true, browser: false },
    browserAllowedOrigins: [],
    browserProfilePersistent: false,
    unread: 0,
    ...overrides
  };
}

function input(value: GeneratedState): Record<string, unknown> {
  const teamId = `team-${value.teamPart}`;
  const roomId = `room-${value.roomPart}`;
  return {
    version: 1,
    savedAt: "2020-01-01T00:00:00.000Z",
    teams: [{ id: teamId, name: value.teamName, members: value.members }],
    rooms: [
      currentRoom({
        id: roomId,
        teamId,
        name: value.roomName,
        unread: value.unread
      })
    ],
    invites: [],
    teamMembers: [
      {
        teamId,
        members: Array.from({ length: value.members }, (_, index) => ({
          teamId,
          userId: `github:member-${index}`,
          role: index === 0 ? "owner" : "member",
          joinedAt: "2020-01-01T00:00:00.000Z"
        }))
      }
    ],
    encryptedBacklog: []
  };
}

function semantic(state: StoredRelayState): Omit<StoredRelayState, "savedAt"> {
  const { savedAt: _, ...rest } = state;
  return rest;
}

function pendingInviteState({
  acceptedMlsEpoch,
  requestEpoch,
  approval = "exact"
}: {
  acceptedMlsEpoch: number;
  requestEpoch: number;
  approval?: "exact" | "none" | "wrong-device" | "wrong-hash" | "wrong-user";
}) {
  const createdAt = "2026-07-11T11:00:00.000Z";
  const expiresAt = "2026-07-13T12:00:00.000Z";
  const keyPackageHash = `sha256:${"a".repeat(64)}`;
  const approvalFields =
    approval === "none"
      ? {}
      : {
          approvedUserId: approval === "wrong-user" ? "github:other" : "github:joiner",
          approvedDeviceId: approval === "wrong-device" ? "device-other" : "device-joiner",
          keyPackageHash: approval === "wrong-hash" ? `sha256:${"b".repeat(64)}` : keyPackageHash
        };
  const sealedRequest = JSON.stringify({
    version: 3,
    binding: {
      version: 3,
      phase: "request",
      inviteId: "invite-one",
      teamId: "team-core",
      roomId: "room-desktop",
      keyEpoch: requestEpoch,
      keyPackageHash,
      requestId: "request-one",
      requestNonce: "nonce-request-one",
      requesterUserId: "github:joiner",
      requesterDeviceId: "device-joiner",
      hostUserId: "github:host",
      hostDeviceId: "device-host",
      expiresAt,
      status: null,
      decidedAt: null
    },
    sealedPayload: {
      version: 1,
      kem_id: 16,
      kdf_id: 1,
      aead_id: 1,
      encapsulated_key: Array(65).fill(1),
      ciphertext: Array(16).fill(2)
    }
  });
  return {
    version: 1,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [
      currentRoom({
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop",
        host: "Host",
        hostUserId: "github:host",
        hostStatus: "active",
        activeHostDeviceId: "device-host",
        acceptedMlsEpoch
      })
    ],
    invites: [
      {
        id: "invite-one",
        teamId: "team-core",
        roomId: "room-desktop",
        expiresAt,
        createdAt,
        ...approvalFields
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [{ teamId: "team-core", userId: "github:host", role: "owner", joinedAt: createdAt }]
      }
    ],
    inviteRequests: [
      {
        requestId: "request-one",
        inviteId: "invite-one",
        requesterUserId: "github:joiner",
        requesterDeviceId: "device-joiner",
        keyPackageId: "kp-one",
        keyPackageHash,
        sealedRequest,
        createdAt
      }
    ],
    mlsBacklog: []
  };
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

test("malformed critical store records fail startup normalization", () => {
  const { codec: storeCodec } = codec();
  const valid = input({
    teamPart: "core",
    roomPart: "desktop",
    teamName: "Core",
    roomName: "Desktop",
    members: 0,
    unread: 0
  });
  assert.throws(
    () => storeCodec.applyStoredRelayState({ ...valid, teams: [null, ...(valid.teams as unknown[])] }),
    /team row failed validation/
  );
});

test("arbitrary decoded store documents never escape codec normalization", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 10 })), (document) => {
      const first = codec();
      try {
        first.codec.applyStoredRelayState({ ...document, version: 1 });
      } catch (error) {
        assert.match(String(error), /Stored relay .* failed validation/);
        return;
      }
      const normalized = first.codec.toStoredRelayState();
      const second = codec();
      assert.doesNotThrow(() => second.codec.applyStoredRelayState(normalized));
      assert.deepEqual(semantic(second.codec.toStoredRelayState()), semantic(normalized));
    }),
    { numRuns: 2_000 }
  );
});

test("every emitted row satisfies its authoritative protocol or persistence schema", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 10 })), (document) => {
      const instance = codec();
      try {
        instance.codec.applyStoredRelayState({ ...document, version: 1 });
      } catch (error) {
        assert.match(String(error), /Stored relay .* failed validation/);
        return;
      }
      const stored = instance.codec.toStoredRelayState();
      assertStoredStateAllowlist(stored);
      assertStoredSchemas(stored);
    }),
    { numRuns: 1_000 }
  );
});

const storedStateKeys = new Set([
  "version",
  "savedAt",
  "teams",
  "rooms",
  "invites",
  "devices",
  "keyPackages",
  "inviteRequests",
  "inviteResponses",
  "inviteAckReceipts",
  "acceptedMessageReceipts",
  "teamMembers",
  "authSessions",
  "accountRestrictions",
  "accountQuotaRecords",
  "appliedDeletionLedgerEntries",
  "attachmentBlobs",
  "mlsBacklog"
]);

const storedRowKeys: Record<string, ReadonlySet<string>> = {
  teams: new Set(["id", "name", "members", "role", "archivedAt", "deletedAt"]),
  rooms: new Set([
    "id",
    "teamId",
    "acceptedMlsEpoch",
    "name",
    "host",
    "hostUserId",
    "activeHostDeviceId",
    "hostStatus",
    "approvalPolicy",
    "mode",
    "browserAllowedOrigins",
    "browserProfilePersistent",
    "unread",
    "archivedAt",
    "deletedAt"
  ]),
  invites: new Set([
    "id",
    "teamId",
    "roomId",
    "creatorUserId",
    "approvedUserId",
    "approvedDeviceId",
    "keyPackageHash",
    "createdAt",
    "expiresAt"
  ]),
  devices: new Set([
    "userId",
    "deviceId",
    "displayName",
    "signaturePublicKey",
    "signatureKeyFingerprint",
    "hpkePublicKey",
    "hpkeKeyFingerprint",
    "registeredAt",
    "lastSeenAt"
  ]),
  keyPackages: new Set([
    "id",
    "keyPackage",
    "keyPackageHash",
    "ciphersuite",
    "userId",
    "deviceId",
    "credentialIdentity",
    "createdAt"
  ]),
  inviteRequests: new Set([
    "requestId",
    "inviteId",
    "requesterUserId",
    "requesterDeviceId",
    "keyPackageId",
    "keyPackageHash",
    "sealedRequest",
    "createdAt"
  ]),
  inviteResponses: new Set([
    "requestId",
    "inviteId",
    "requesterUserId",
    "requesterDeviceId",
    "keyPackageHash",
    "status",
    "responseBinding",
    "responseMac",
    "welcome",
    "createdAt"
  ]),
  inviteAckReceipts: new Set([
    "inviteId",
    "requestId",
    "teamId",
    "requesterUserId",
    "requesterDeviceId",
    "keyPackageHash",
    "status",
    "acknowledgedAt",
    "expiresAt"
  ]),
  acceptedMessageReceipts: new Set([
    "roomKey",
    "messageId",
    "messageType",
    "senderUserId",
    "senderDeviceId",
    "parentEpoch",
    "digest",
    "acceptedAt"
  ]),
  teamMembers: new Set(["teamId", "members"]),
  authSessions: new Set(["sessionIdHash", "user", "expiresAt"]),
  accountRestrictions: new Set(["userId", "reasonCode", "createdAt", "expiresAt"]),
  accountQuotaRecords: new Set(["key", "userId", "quota", "used", "resetAt"]),
  appliedDeletionLedgerEntries: new Set(["entryId", "appliedAt"]),
  attachmentBlobs: new Set([
    "id",
    "teamId",
    "roomId",
    "name",
    "type",
    "size",
    "uploadedByUserId",
    "epoch",
    "sealedBlob",
    "createdAt",
    "expiresAt"
  ]),
  mlsBacklog: new Set(["key", "messages"])
};

function assertStoredStateAllowlist(stored: StoredRelayState): void {
  assertOnlyKeys(stored, storedStateKeys, "stored state");
  for (const [collection, allowed] of Object.entries(storedRowKeys)) {
    const rows = stored[collection as keyof StoredRelayState];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) assertOnlyKeys(row, allowed, collection);
  }
  for (const backlog of stored.mlsBacklog) {
    for (const message of backlog.messages) {
      assert.equal(MlsRelayMessage.safeParse(message).success, true);
      assertOnlyKeys(
        message,
        new Set([
          "id",
          "teamId",
          "roomId",
          "senderDeviceId",
          "senderUserId",
          "createdAt",
          "messageType",
          "epochHint",
          "mlsMessage",
          "commitEffect",
          "nextHostUserId",
          "nextHostDeviceId",
          "hostTransferAuthorization"
        ]),
        "mlsBacklog.messages"
      );
    }
  }
}

function assertStoredSchemas(stored: StoredRelayState): void {
  for (const [schema, rows] of [
    [TeamRecord, stored.teams],
    [RoomRecord, stored.rooms],
    [InviteRecord, stored.invites],
    [DeviceRecord, stored.devices ?? []],
    [KeyPackageRecord, stored.keyPackages ?? []],
    [InviteJoinRequestRecord, stored.inviteRequests ?? []],
    [InviteResponseRecord, stored.inviteResponses ?? []],
    [TeamMemberRecord, stored.teamMembers?.flatMap((entry) => entry.members ?? []) ?? []],
    [AttachmentBlobRecord, stored.attachmentBlobs ?? []],
    [StoredInviteAckReceipt, stored.inviteAckReceipts ?? []],
    [StoredAcceptedMessageReceipt, stored.acceptedMessageReceipts ?? []],
    [StoredAccountRestriction, stored.accountRestrictions ?? []],
    [StoredAccountQuotaRecord, stored.accountQuotaRecords ?? []],
    [StoredDeletionLedgerEntry, stored.appliedDeletionLedgerEntries ?? []]
  ] as const) {
    for (const row of rows) assert.equal(schema.safeParse(row).success, true);
  }
}

function assertOnlyKeys(value: unknown, allowed: ReadonlySet<string>, label: string): void {
  assert.equal(typeof value, "object", `${label} must serialize as an object`);
  assert.ok(value !== null && !Array.isArray(value), `${label} must serialize as a record`);
  const unexpected = Object.keys(value as object).filter((key) => !allowed.has(key));
  assert.deepEqual(unexpected, [], `${label} serialized fields outside its allowlist`);
}

test("a complete valid relay store strips unknown fields and exercises every persisted entity allowlist", () => {
  const signaturePublicKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64");
  const hpke = createECDH("prime256v1");
  hpke.generateKeys();
  const hpkePublicKey = hpke.getPublicKey(undefined, "uncompressed").toString("base64");
  const createdAt = "2026-07-11T11:00:00.000Z";
  const expiresAt = "2026-07-13T12:00:00.000Z";
  const keyPackageHash = `sha256:${"a".repeat(64)}`;
  const pending = pendingInviteState({ acceptedMlsEpoch: 0, requestEpoch: 0, approval: "none" });
  const state = {
    ...pending,
    unknownRoot: "must not persist",
    teams: [{ ...(pending.teams[0] as object), members: 2 }],
    rooms: [
      {
        ...(pending.rooms[0] as object),
        mode: { chat: true, code: true, workspace: true, browser: false }
      }
    ],
    invites: [{ ...(pending.invites[0] as object), unknownInvite: "must not persist" }],
    devices: [
      {
        userId: "github:joiner",
        deviceId: "device-joiner",
        displayName: "Joiner",
        signaturePublicKey,
        signatureKeyFingerprint: publicKeyFingerprint(signaturePublicKey),
        hpkePublicKey,
        hpkeKeyFingerprint: publicKeyFingerprint(hpkePublicKey),
        registeredAt: createdAt,
        lastSeenAt: createdAt
      }
    ],
    keyPackages: [
      {
        id: "kp-one",
        keyPackage: "AA==",
        keyPackageHash,
        ciphersuite: 2,
        userId: "github:joiner",
        deviceId: "device-joiner",
        credentialIdentity: "github:joiner",
        createdAt,
        unknownKeyPackage: "must not persist"
      }
    ],
    inviteRequests: (pending.inviteRequests as object[]).map((request) => ({
      ...request,
      unknownRequest: "must not persist"
    })),
    inviteResponses: [
      {
        requestId: "request-one",
        inviteId: "invite-one",
        requesterUserId: "github:joiner",
        requesterDeviceId: "device-joiner",
        keyPackageHash,
        status: "denied",
        responseBinding: {
          version: 3,
          phase: "response",
          inviteId: "invite-one",
          teamId: "team-core",
          roomId: "room-desktop",
          keyEpoch: 0,
          keyPackageHash,
          requestId: "request-one",
          requestNonce: "nonce-request-one",
          requesterUserId: "github:joiner",
          requesterDeviceId: "device-joiner",
          hostUserId: "github:host",
          hostDeviceId: "device-host",
          expiresAt,
          status: "denied",
          decidedAt: createdAt
        },
        responseMac: "AA==",
        createdAt,
        unknownResponse: "must not persist"
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { teamId: "team-core", userId: "github:host", role: "owner", joinedAt: createdAt },
          { teamId: "team-core", userId: "github:joiner", role: "member", joinedAt: createdAt }
        ]
      }
    ],
    inviteAckReceipts: [
      {
        inviteId: "invite-one",
        requestId: "request-one",
        teamId: "team-core",
        requesterUserId: "github:joiner",
        requesterDeviceId: "device-joiner",
        keyPackageHash,
        status: "approved",
        acknowledgedAt: createdAt,
        expiresAt,
        unknownAck: "must not persist"
      }
    ],
    acceptedMessageReceipts: [
      {
        roomKey: "team-core:room-desktop",
        messageId: "message-one",
        messageType: "application",
        senderUserId: "github:host",
        senderDeviceId: "device-host",
        parentEpoch: 0,
        digest: "c".repeat(64),
        acceptedAt: createdAt,
        unknownReceipt: "must not persist"
      }
    ],
    authSessions: [
      {
        sessionIdHash: createHash("sha256").update("complete-session").digest("hex"),
        user: { id: "github:joiner", login: "joiner" },
        expiresAt: Date.now() + 60_000
      }
    ],
    accountRestrictions: [
      { userId: "github:restricted", reasonCode: "abuse", createdAt, unknownRestriction: "must not persist" }
    ],
    accountQuotaRecords: [
      {
        key: "daily_room_creations:github:joiner",
        userId: "github:joiner",
        quota: "daily_room_creations",
        used: 1,
        resetAt: fixedNow + 60_000,
        unknownQuota: "must not persist"
      }
    ],
    appliedDeletionLedgerEntries: [
      { entryId: "ledger-one", appliedAt: createdAt, unknownDeletion: "must not persist" }
    ],
    attachmentBlobs: [
      {
        id: "blob-one",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "opaque.bin",
        type: "application/octet-stream",
        size: 1,
        uploadedByUserId: "github:joiner",
        epoch: 0,
        sealedBlob: JSON.stringify({
          version: 1,
          epoch: 0,
          nonce: Buffer.alloc(12).toString("base64"),
          ciphertext: "AA=="
        }),
        createdAt,
        expiresAt,
        unknownBlob: "must not persist"
      }
    ],
    mlsBacklog: [
      {
        key: "team-core:room-desktop",
        messages: [
          {
            id: "message-one",
            teamId: "team-core",
            roomId: "room-desktop",
            senderUserId: "github:host",
            senderDeviceId: "device-host",
            createdAt,
            messageType: "application",
            epochHint: 0,
            mlsMessage: "AA=="
          }
        ],
        unknownBacklog: "must not persist"
      }
    ]
  };

  const instance = codec();
  instance.codec.applyStoredRelayState(state);
  const stored = instance.codec.toStoredRelayState();
  assertStoredStateAllowlist(stored);
  assertStoredSchemas(stored);
  for (const collection of Object.keys(storedRowKeys)) {
    assert.ok(Array.isArray(stored[collection as keyof StoredRelayState]));
    assert.ok(
      (stored[collection as keyof StoredRelayState] as unknown[]).length > 0,
      `${collection} was not exercised`
    );
  }
  assert.equal(stored.teamMembers?.[0]?.members?.length, 2);

  const unknownDeviceField = structuredClone(state);
  Object.assign(unknownDeviceField.devices[0]!, { unknownDevice: true });
  assert.throws(() => codec().codec.applyStoredRelayState(unknownDeviceField), /device row failed validation/);

  fc.assert(
    fc.property(
      fc.stringMatching(/^unknown_[a-z0-9_]{1,20}$/),
      fc.jsonValue({ maxDepth: 4 }),
      (unknownKey, unknownValue) => {
        const contaminated = structuredClone(state) as Record<string, unknown>;
        for (const collection of Object.keys(storedRowKeys).filter(
          (collection) => !["teams", "rooms", "devices", "teamMembers", "authSessions"].includes(collection)
        )) {
          const rows = contaminated[collection];
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (row && typeof row === "object") Object.assign(row, { [unknownKey]: unknownValue });
          }
        }
        const arbitrary = codec();
        arbitrary.codec.applyStoredRelayState(contaminated);
        const arbitraryStored = arbitrary.codec.toStoredRelayState();
        assertStoredStateAllowlist(arbitraryStored);
        assertStoredSchemas(arbitraryStored);
        for (const collection of Object.keys(storedRowKeys)) {
          assert.ok((arbitraryStored[collection as keyof StoredRelayState] as unknown[]).length > 0);
        }
        assertNestedKeyAbsent(arbitraryStored, unknownKey);
      }
    ),
    { numRuns: 100 }
  );

  const nestedUnknown = structuredClone(state);
  (nestedUnknown.inviteResponses[0]!.responseBinding as Record<string, unknown>).unknownBinding =
    "must reject the strict cryptographic binding";
  const rejected = codec();
  rejected.codec.applyStoredRelayState(nestedUnknown);
  assert.equal(rejected.store.inviteResponses.size, 0);
});

function publicKeyFingerprint(encoded: string): string {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)!.join(":")}`;
}

function assertNestedKeyAbsent(value: unknown, forbidden: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNestedKeyAbsent(item, forbidden);
    return;
  }
  if (!value || typeof value !== "object") return;
  assert.equal(Object.hasOwn(value, forbidden), false);
  for (const child of Object.values(value)) assertNestedKeyAbsent(child, forbidden);
}

test("malformed current account restrictions fail startup while expired restrictions are discarded", () => {
  const malformed = codec();
  assert.throws(
    () =>
      malformed.codec.applyStoredRelayState({
        version: 1,
        accountRestrictions: [
          { userId: "github:restricted", reasonCode: "NOT_ALLOWED", createdAt: "2026-07-11T11:00:00.000Z" }
        ]
      }),
    /account-restriction row failed validation/
  );

  const expired = codec();
  assert.doesNotThrow(() =>
    expired.codec.applyStoredRelayState({
      version: 1,
      accountRestrictions: [
        {
          userId: "github:expired",
          reasonCode: "abuse",
          createdAt: "2026-07-10T11:00:00.000Z",
          expiresAt: new Date(fixedNow).toISOString()
        }
      ]
    })
  );
  assert.equal(expired.store.accountRestrictions.size, 0);
});

test("invalid non-authoritative persistence rows are dropped independently of valid siblings", () => {
  const { store, codec: relayCodec } = codec();
  relayCodec.applyStoredRelayState({
    version: 1,
    accountRestrictions: [{ userId: "github:valid", reasonCode: "abuse", createdAt: "2026-07-11T11:00:00.000Z" }],
    accountQuotaRecords: [
      {
        key: "daily_team_creations:github:valid",
        userId: "github:valid",
        quota: "daily_team_creations",
        used: 2,
        resetAt: fixedNow + 60_000
      },
      {
        key: "daily_room_creations:github:other",
        userId: "github:valid",
        quota: "daily_room_creations",
        used: 1,
        resetAt: fixedNow + 60_000
      }
    ],
    appliedDeletionLedgerEntries: [
      { entryId: "ledger-valid", appliedAt: "2026-07-11T11:00:00.000Z" },
      { entryId: "ledger-invalid", appliedAt: "not-a-date" }
    ]
  });
  assert.deepEqual([...store.accountRestrictions.keys()], ["github:valid"]);
  assert.deepEqual([...store.accountQuotaRecords.keys()], ["daily_team_creations:github:valid"]);
  assert.deepEqual([...store.appliedDeletionLedgerEntries.keys()], ["ledger-valid"]);
});

test("unsupported store versions cannot partially populate an existing store", () => {
  const instance = codec();
  instance.store.teams.set("team-existing", { id: "team-existing", name: "Existing", members: 0 });
  assert.throws(
    () =>
      instance.codec.applyStoredRelayState({
        version: 2,
        teams: [{ id: "team-new", name: "New", members: 0 }]
      }),
    /unsupported version/
  );
  assert.deepEqual([...instance.store.teams.keys()], ["team-existing"]);
});

test("expiry and pruning use the injected clock", () => {
  const { store, codec: storeCodec } = codec();
  store.authSessions.set("expired", {
    sessionIdHash: "expired",
    user: { id: "user", login: "user" },
    expiresAt: fixedNow
  });
  store.authSessions.set("active", {
    sessionIdHash: "active",
    user: { id: "user", login: "user" },
    expiresAt: fixedNow + 1
  });
  store.setRoom({
    id: "room-archived",
    teamId: "team-core",
    name: "Archived",
    host: "No host",
    hostStatus: "offline",
    unread: 0,
    archivedAt: new Date(fixedNow - 1).toISOString()
  });
  store.setMlsBacklog("team-core:room-archived", [
    {
      id: "message-one",
      teamId: "team-core",
      roomId: "room-archived",
      senderUserId: "github:owner",
      senderDeviceId: "device-owner",
      createdAt: new Date(fixedNow - 1).toISOString(),
      messageType: "application",
      epochHint: 0,
      mlsMessage: "AA=="
    }
  ]);
  store.setAttachmentBlob({
    id: "blob-expired",
    teamId: "team-core",
    roomId: "room-archived",
    name: "expired",
    type: "file",
    size: 1,
    epoch: 0,
    sealedBlob: "{}",
    createdAt: new Date(fixedNow - 2).toISOString(),
    expiresAt: new Date(fixedNow - 1).toISOString()
  });
  storeCodec.discardStoredRelayMutations();
  storeCodec.pruneExpiredRelayState();
  assert.equal(store.authSessions.has("expired"), false);
  assert.equal(store.authSessions.has("active"), true);
  assert.equal(store.attachmentBlobs.size, 0);
  assert.equal(store.mlsBacklog.size, 0);
  const mutations = storeCodec.drainStoredRelayMutations();
  assert.ok(
    mutations.some(
      (mutation) =>
        mutation.entity === "attachmentBlobs" && mutation.key === "blob-expired" && mutation.operation === "delete"
    )
  );
  assert.ok(
    mutations.some(
      (mutation) =>
        mutation.entity === "mlsBacklog" &&
        mutation.key === "team-core:room-archived" &&
        mutation.operation === "delete"
    )
  );
});

test("startup normalization discards non-canonical opaque encodings", () => {
  const { store, codec: storeCodec } = codec();
  const createdAt = "2026-07-11T11:00:00.000Z";
  storeCodec.applyStoredRelayState({
    version: 1,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [
      currentRoom({
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop"
      })
    ],
    invites: [],
    teamMembers: [
      {
        teamId: "team-core",
        members: [{ teamId: "team-core", userId: "github:owner", role: "owner", joinedAt: createdAt }]
      }
    ],
    devices: [],
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
    mlsBacklog: []
  });
  assert.equal(store.keyPackages.size, 0);
  assert.equal(store.inviteRequests.size, 0);
  assert.equal(store.inviteResponses.size, 0);
  assert.equal(store.attachmentBlobs.size, 0);
  assert.equal(store.mlsBacklog.size, 0);
});

test("startup accepts only explicit current-schema team membership rows", () => {
  const createdAt = "2026-07-11T11:00:00.000Z";
  const base = {
    version: 1,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [],
    invites: [],
    mlsBacklog: []
  };
  for (const member of [
    { teamId: "team-core", userId: "github:owner", role: "invalid", joinedAt: createdAt },
    { teamId: "team-other", userId: "github:owner", role: "owner", joinedAt: createdAt },
    { teamId: "team-core", userId: "github:owner", role: "owner", joinedAt: "not-a-date" }
  ]) {
    assert.throws(
      () =>
        codec().codec.applyStoredRelayState({
          ...base,
          teamMembers: [{ teamId: "team-core", members: [member] }]
        }),
      /team-member row failed validation/
    );
  }
  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        ...base,
        teamMembers: [{ teamId: "team-core", userIds: ["github:owner", null, " "] }]
      }),
    /team-member row failed validation/
  );
  const current = codec();
  current.codec.applyStoredRelayState({
    ...base,
    teamMembers: [
      {
        teamId: "team-core",
        members: [{ teamId: "team-core", userId: "github:owner", role: "owner", joinedAt: createdAt }]
      }
    ]
  });
  assert.equal(current.store.getTeamMember("team-core", "github:owner")?.role, "owner");
});

test("startup rejects membership count, ownership, duplicate rows, and host cross-record corruption", () => {
  const createdAt = "2026-07-11T11:00:00.000Z";
  const member = (userId: string, role: "owner" | "admin" | "member") => ({
    teamId: "team-core",
    userId,
    role,
    joinedAt: createdAt
  });
  const base = {
    version: 1,
    teams: [{ id: "team-core", name: "Core", members: 2 }],
    rooms: [],
    invites: [],
    mlsBacklog: []
  };
  for (const teamMembers of [
    [],
    [{ teamId: "team-core", members: [member("github:owner", "owner")] }],
    [{ teamId: "team-core", members: [member("github:a", "owner"), member("github:b", "owner")] }],
    [{ teamId: "team-core", members: [member("github:a", "member"), member("github:b", "member")] }],
    [
      { teamId: "team-core", members: [member("github:a", "owner"), member("github:b", "member")] },
      { teamId: "team-core", members: [member("github:a", "owner"), member("github:b", "member")] }
    ]
  ]) {
    assert.throws(() => codec().codec.applyStoredRelayState({ ...base, teamMembers }), /Stored relay team/);
  }

  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        ...base,
        rooms: [
          currentRoom({
            id: "room-desktop",
            teamId: "team-core",
            name: "Desktop",
            host: "Removed host",
            hostUserId: "github:removed",
            hostStatus: "offline"
          })
        ],
        teamMembers: [
          { teamId: "team-core", members: [member("github:owner", "owner"), member("github:member", "member")] }
        ]
      }),
    /room host membership failed validation/
  );
});

test("startup fails closed on malformed current MLS backlog while allowing intentional pruning", () => {
  const createdAt = "2026-07-11T11:00:00.000Z";
  const message: MlsRelayMessage = {
    id: "message-one",
    teamId: "team-core",
    roomId: "room-desktop",
    senderUserId: "github:owner",
    senderDeviceId: "device-owner",
    createdAt,
    messageType: "application",
    epochHint: 0,
    mlsMessage: "AA=="
  };
  const base = {
    version: 1,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [
      currentRoom({
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop"
      })
    ],
    invites: [],
    teamMembers: [
      {
        teamId: "team-core",
        members: [{ teamId: "team-core", userId: "github:owner", role: "owner", joinedAt: createdAt }]
      }
    ]
  };
  for (const candidate of [
    { ...message, mlsMessage: "AB==" },
    { ...message, roomId: "room-other" },
    { ...message, messageType: "unknown" }
  ]) {
    assert.throws(
      () =>
        codec().codec.applyStoredRelayState({
          ...base,
          mlsBacklog: [{ key: "team-core:room-desktop", messages: [candidate] }]
        }),
      /MLS backlog row failed validation/
    );
  }
  const pruned = codec(new InMemoryRelayStore(), () => []);
  pruned.codec.applyStoredRelayState({
    ...base,
    mlsBacklog: [{ key: "team-core:room-desktop", messages: [message] }]
  });
  assert.equal(pruned.store.mlsBacklog.size, 0);
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
      currentRoom({
        id: "room-desktop",
        teamId: "team-core",
        name: "Room",
        host: "Host",
        hostUserId: "github:host",
        activeHostDeviceId: "device-host",
        hostStatus: "active",
        acceptedMlsEpoch: 1
      })
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
          { teamId: "team-core", userId: "github:host", role: "owner", joinedAt: createdAt },
          { teamId: "team-core", userId: "github:joiner", role: "member", joinedAt: createdAt }
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

test("startup normalization retains only the exact approved request from the immediately preceding epoch", async (t) => {
  await t.test("retains the approved request after its membership Commit advances the room epoch", () => {
    const { store, codec: relayCodec } = codec();
    relayCodec.applyStoredRelayState(pendingInviteState({ acceptedMlsEpoch: 2, requestEpoch: 1 }));
    assert.equal(store.inviteRequests.has("request-one"), true);
  });

  await t.test("retains a pending request for the current epoch without approval", () => {
    const { store, codec: relayCodec } = codec();
    relayCodec.applyStoredRelayState(pendingInviteState({ acceptedMlsEpoch: 1, requestEpoch: 1, approval: "none" }));
    assert.equal(store.inviteRequests.has("request-one"), true);
  });

  for (const approval of ["none", "wrong-user", "wrong-device", "wrong-hash"] as const) {
    await t.test(`rejects a previous-epoch request with ${approval} approval`, () => {
      const { store, codec: relayCodec } = codec();
      relayCodec.applyStoredRelayState(pendingInviteState({ acceptedMlsEpoch: 2, requestEpoch: 1, approval }));
      assert.equal(store.inviteRequests.has("request-one"), false);
    });
  }

  await t.test("rejects an approved request more than one epoch behind", () => {
    const { store, codec: relayCodec } = codec();
    relayCodec.applyStoredRelayState(pendingInviteState({ acceptedMlsEpoch: 3, requestEpoch: 1 }));
    assert.equal(store.inviteRequests.has("request-one"), false);
  });
});

test("startup accepts a complete current offline room without synthesizing authorization fields", () => {
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
        host: "Creator",
        hostUserId: "github:creator",
        hostStatus: "offline",
        approvalPolicy: "ask_every_turn",
        mode: { chat: true, code: true, workspace: true, browser: true },
        browserAllowedOrigins: ["https://github.com"],
        browserProfilePersistent: true,
        unread: 0
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          {
            teamId: "team-core",
            userId: "github:creator",
            role: "owner",
            joinedAt: "2026-07-12T12:00:00.000Z"
          }
        ]
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

test("startup rejects incomplete or legacy-shaped critical team and room rows", () => {
  const base = {
    version: 1,
    savedAt: "2026-07-12T12:00:00.000Z",
    teams: [{ id: "team-core", name: "Core", members: 0 }],
    rooms: [],
    teamMembers: []
  };
  assert.throws(
    () => codec().codec.applyStoredRelayState({ ...base, teams: [{ id: "team-core", members: 0 }] }),
    /team row failed validation/
  );
  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        ...base,
        rooms: [
          {
            id: "room",
            teamId: "team-core",
            name: "Room",
            host: "No host",
            hostStatus: "offline",
            approvalPolicy: "ask_every_turn",
            unread: 0
          }
        ]
      }),
    /room row failed validation/
  );
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { MlsRelayMessage, RoomRecord } from "@multaiplayer/protocol";
import { createRelayStoreCodec } from "../src/store-codec.js";
import { createRelayAuthSessionPersistence } from "../src/auth/session.js";
import { SqliteRelayPersistence } from "../src/sqlite-persistence.js";
import { InMemoryRelayStore } from "../src/state.js";
import { createRelayStorePersistenceCoordinator, RelayPersistenceLoadError } from "../src/store-persistence.js";

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

function currentRoom(overrides: Partial<RoomRecord> & Pick<RoomRecord, "id" | "teamId" | "name">): RoomRecord {
  return {
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    browserProfilePersistent: false,
    ...overrides
  };
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

test("malformed current account quotas fail startup while expired quotas are discarded", () => {
  const malformed = codec();
  assert.throws(
    () =>
      malformed.codec.applyStoredRelayState({
        version: 1,
        accountQuotaRecords: [
          {
            key: "daily_room_creations:github:other",
            userId: "github:user",
            quota: "daily_room_creations",
            used: 1,
            resetAt: fixedNow + 60_000
          }
        ]
      }),
    /account-quota row failed validation/
  );

  const expired = codec();
  assert.doesNotThrow(() =>
    expired.codec.applyStoredRelayState({
      version: 1,
      accountQuotaRecords: [
        {
          key: "daily_room_creations:github:user",
          userId: "github:user",
          quota: "daily_room_creations",
          used: 1,
          resetAt: fixedNow
        }
      ]
    })
  );
  assert.equal(expired.store.accountQuotaRecords.size, 0);
  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        version: 1,
        accountQuotaRecords: [
          {
            key: "daily_room_creations:github:user",
            userId: "github:user",
            quota: "daily_room_creations",
            used: 1,
            resetAt: fixedNow,
            legacyWindow: "daily"
          }
        ]
      }),
    /account-quota row failed validation/
  );
});

test("malformed current accepted-message receipts fail startup while expired receipts are discarded", () => {
  const base = {
    version: 1,
    teams: [{ id: "team-core", name: "Core", members: 1 }],
    rooms: [currentRoom({ id: "room-desktop", teamId: "team-core", name: "Desktop" })],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          {
            teamId: "team-core",
            userId: "github:host",
            role: "owner",
            joinedAt: "2026-07-11T11:00:00.000Z"
          }
        ]
      }
    ]
  };
  const receipt = {
    roomKey: "team-core:room-desktop",
    messageId: "message-one",
    messageType: "commit",
    senderUserId: "github:host",
    senderDeviceId: "device-host",
    parentEpoch: 1,
    digest: "c".repeat(64),
    acceptedAt: "2026-07-11T11:00:00.000Z"
  };

  const malformed = codec();
  assert.throws(
    () =>
      malformed.codec.applyStoredRelayState({
        ...base,
        acceptedMessageReceipts: [{ ...receipt, roomKey: "team-core:room-missing" }]
      }),
    /accepted-message-receipt row failed validation/
  );

  const expired = codec();
  assert.doesNotThrow(() =>
    expired.codec.applyStoredRelayState({
      ...base,
      acceptedMessageReceipts: [{ ...receipt, acceptedAt: "2026-01-01T00:00:00.000Z" }]
    })
  );
  assert.equal(expired.store.acceptedMessageReceipts.size, 0);
  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        ...base,
        acceptedMessageReceipts: [
          { ...receipt, acceptedAt: "2026-01-01T00:00:00.000Z", legacyDigestAlgorithm: "sha256" }
        ]
      }),
    /accepted-message-receipt row failed validation/
  );
});

test("SQLite startup fails closed on a malformed durable quota row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-malformed-quota-"));
  const dataPath = join(directory, "relay.sqlite");
  const initial = new SqliteRelayPersistence(dataPath);
  try {
    await initial.save({
      version: 1,
      savedAt: new Date(fixedNow).toISOString(),
      teams: [],
      rooms: [],
      accountQuotaRecords: [
        {
          key: "daily_room_creations:github:user",
          userId: "github:user",
          quota: "daily_room_creations",
          used: 1,
          resetAt: fixedNow + 60_000
        }
      ],
      mlsBacklog: []
    });
    initial.close();
    const database = new Database(dataPath);
    const row = database
      .prepare("select data_json from relay_account_quota_records where quota_key = ?")
      .get("daily_room_creations:github:user") as { data_json: string };
    database
      .prepare("update relay_account_quota_records set data_json = ? where quota_key = ?")
      .run(JSON.stringify({ ...JSON.parse(row.data_json), legacyWindow: "daily" }), "daily_room_creations:github:user");
    database.close();

    const persistence = new SqliteRelayPersistence(dataPath);
    const coordinator = createRelayStorePersistenceCoordinator({
      dataPath,
      persistence,
      storeCodec: codec().codec
    });
    await assert.rejects(coordinator.loadRelayStore(), RelayPersistenceLoadError);
    persistence.close();
  } finally {
    initial.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid non-critical persistence rows are dropped independently of valid siblings", () => {
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
    approvalPolicy: "ask_every_turn",
    browserProfilePersistent: false,
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
        browserProfilePersistent: true
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
            approvalPolicy: "ask_every_turn"
          }
        ]
      }),
    /room row failed validation/
  );
  assert.throws(
    () =>
      codec().codec.applyStoredRelayState({
        ...base,
        rooms: [
          {
            ...currentRoom({ id: "room", teamId: "team-core", name: "Room" }),
            approvalDelegationPolicy: "host_only"
          }
        ]
      }),
    /room row failed validation/
  );
});

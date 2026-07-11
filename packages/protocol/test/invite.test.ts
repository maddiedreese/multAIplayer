import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CodexApprovalPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  DevicePublicKeyJwk,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  DeviceRecord,
  HostHandoffPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RelayEnvelope,
  RelayServerMessage,
  RoomId,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  RoomKeyRotationPlaintextPayload,
  TerminalResultPlaintextPayload,
  TeamId,
  TeamMemberRecord,
  TeamRecord,
  WorkspaceFileSaveRequestPlaintextPayload,
  maxGitHubActionRuns,
  maxGitWorkflowResults,
  maxLongTextChars,
  maxUrlChars,
  defaultCodexModel,
  defaultRoomMode,
  maxWrappedCiphertextChars
} from "../src/index";

test("team and room ids use relay-safe bounded identifiers", () => {
  assert.equal(TeamId.parse("team-core"), "team-core");
  assert.equal(TeamId.parse("team_core"), "team_core");
  assert.equal(RoomId.parse("room-desktop"), "room-desktop");
  assert.equal(RoomId.parse("room_desktop"), "room_desktop");

  for (const value of ["team:core", "team/core", " team-core", "team-core ", "te", "x".repeat(161)]) {
    assert.equal(TeamId.safeParse(value).success, false, `${value} should not be a valid team id`);
  }
  for (const value of ["room:desktop", "room/desktop", " room-desktop", "room-desktop ", "ro", "x".repeat(161)]) {
    assert.equal(RoomId.safeParse(value).success, false, `${value} should not be a valid room id`);
  }
});

test("relay publish acknowledgements identify the durably accepted envelope", () => {
  assert.deepEqual(RelayServerMessage.parse({ type: "published", envelopeId: "envelope-accepted" }), {
    type: "published",
    envelopeId: "envelope-accepted"
  });
  assert.equal(RelayServerMessage.safeParse({ type: "published", envelopeId: "" }).success, false);
});

test("chat payloads can carry encrypted reply references", () => {
  const parsed = ChatPlaintextPayload.parse({
    id: "message-2",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "agreed, do that",
    time: "9:43 AM",
    replyTo: "message-1"
  });

  assert.equal(parsed.replyTo, "message-1");
  assert.equal(ChatPlaintextPayload.safeParse({ ...parsed, authorUserId: undefined }).success, false);
  assert.equal(
    ChatPlaintextPayload.safeParse({
      id: "message-3",
      author: "Maddie",
      authorUserId: "github:maddie",
      role: "human",
      body: "bad reply",
      time: "9:44 AM",
      replyTo: ""
    }).success,
    false
  );
});

test("chat payloads can carry author ids and encrypted edit/delete events", () => {
  const message = ChatPlaintextPayload.parse({
    id: "message-2",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "agreed, do that",
    time: "9:43 AM"
  });
  const edit = ChatEditPlaintextPayload.parse({
    id: "edit-1",
    messageId: "message-2",
    body: "agreed, please do that",
    editedBy: "Maddie",
    editedByUserId: "github:maddie",
    editedAt: "2026-07-08T12:00:00.000Z"
  });
  const deletion = ChatDeletePlaintextPayload.parse({
    id: "delete-1",
    messageId: "message-2",
    deletedBy: "Maddie",
    deletedByUserId: "github:maddie",
    deletedAt: "2026-07-08T12:01:00.000Z"
  });

  assert.equal(message.authorUserId, "github:maddie");
  assert.equal(edit.body, "agreed, please do that");
  assert.equal(deletion.deletedByUserId, "github:maddie");
  assert.equal(
    ChatEditPlaintextPayload.safeParse({
      id: "bad-edit",
      messageId: "message-2",
      body: "",
      editedBy: "Maddie",
      editedByUserId: "github:maddie",
      editedAt: "2026-07-08T12:00:00.000Z"
    }).success,
    false
  );
});

test("team records can carry the current user's role", () => {
  const parsed = TeamRecord.parse({
    id: "team-core",
    name: "Core Team",
    members: 4,
    role: "owner",
    archivedAt: "2026-07-09T12:00:00.000Z"
  });

  assert.equal(parsed.role, "owner");
  assert.equal(parsed.archivedAt, "2026-07-09T12:00:00.000Z");
});

test("room records can carry lifecycle timestamps", () => {
  const parsed = RoomRecord.parse({
    id: "room-desktop",
    teamId: "team-core",
    name: "Desktop",
    projectPath: "/tmp/project",
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: defaultRoomMode,
    codexModel: defaultCodexModel,
    browserAllowedOrigins: [],
    browserProfilePersistent: true,
    unread: 0,
    deletedAt: "2026-07-09T12:05:00.000Z"
  });

  assert.equal(parsed.deletedAt, "2026-07-09T12:05:00.000Z");
});

test("team member records carry role and join metadata", () => {
  const parsed = TeamMemberRecord.parse({
    teamId: "team-core",
    userId: "github:maddiedreese",
    role: "admin",
    joinedAt: "2026-07-04T12:00:00.000Z"
  });

  assert.equal(parsed.role, "admin");
});

test("device public key JWKs require bounded public P-256 material", () => {
  const parsed = DevicePublicKeyJwk.parse({
    kty: "EC",
    crv: "P-256",
    x: "x-coordinate",
    y: "y-coordinate",
    ext: true,
    key_ops: []
  });
  assert.equal(parsed.kty, "EC");
  assert.equal(parsed.crv, "P-256");

  assert.equal(
    DevicePublicKeyJwk.safeParse({
      kty: "EC",
      crv: "P-256",
      x: "x-coordinate",
      y: "y-coordinate",
      d: "private-material"
    }).success,
    false
  );
  assert.equal(
    DevicePublicKeyJwk.safeParse({
      kty: "EC",
      crv: "P-384",
      x: "x-coordinate",
      y: "y-coordinate"
    }).success,
    false
  );
  assert.equal(
    DevicePublicKeyJwk.safeParse({
      kty: "RSA",
      n: "modulus",
      e: "AQAB"
    }).success,
    false
  );
  assert.equal(
    DevicePublicKeyJwk.safeParse({
      kty: "EC",
      crv: "P-256",
      x: "x".repeat(129),
      y: "y-coordinate"
    }).success,
    false
  );
});

test("device records carry bounded public key JWKs", () => {
  const parsed = DeviceRecord.parse({
    userId: "github:maddiedreese",
    deviceId: "device_12345678",
    displayName: "Maddie",
    publicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "x-coordinate",
      y: "y-coordinate",
      ext: true
    },
    publicKeyFingerprint: "sha256:" + "1111:".repeat(15) + "1111",
    registeredAt: "2026-07-04T12:00:00.000Z",
    lastSeenAt: "2026-07-04T12:01:00.000Z"
  });

  assert.equal(parsed.publicKeyJwk.crv, "P-256");
});
test("host handoff payloads can report room-visible acceptance", () => {
  const parsed = HostHandoffPlaintextPayload.parse({
    id: "handoff-1",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "usage_limit",
    projectPath: "/tmp/multaiplayer",
    gitRemoteUrl: "https://github.com/maddiedreese/multAIplayer",
    gitRepoOwner: "maddiedreese",
    gitRepoName: "multAIplayer",
    gitBranch: "main",
    gitDirtyFiles: ["apps/desktop/src/App.tsx"],
    gitPatch: "diff --git a/README.md b/README.md\n",
    gitPatchTruncated: false,
    codexModel: "gpt-5.4",
    codexReasoningEffort: "max",
    approvalPolicy: "ask_every_turn",
    messagesSinceLastCodex: 2,
    queuedCodexTurns: [
      {
        turnId: "turn-queued-1",
        requestedBy: "Jordan",
        requestedByUserId: "github:jordan",
        queuedAt: "2026-07-04T12:03:00.000Z",
        triggerMessageId: "message-2"
      }
    ],
    attachmentNames: [],
    terminals: ["tests"],
    continuationSummary: "Maddie is out of Codex usage.",
    createdAt: "2026-07-04T12:00:00.000Z",
    status: "accepted",
    acceptedBy: "Alex",
    acceptedByUserId: "github:alex",
    acceptedAt: "2026-07-04T12:05:00.000Z"
  });

  assert.equal(parsed.status, "accepted");
  assert.equal(parsed.codexReasoningEffort, "max");
  assert.equal(parsed.acceptedBy, "Alex");
  assert.equal(parsed.queuedCodexTurns?.[0]?.turnId, "turn-queued-1");
  assert.equal(
    HostHandoffPlaintextPayload.safeParse({
      id: "handoff-bad-queue",
      fromHost: "Maddie",
      fromUserId: "github:maddie",
      projectPath: "/tmp/multaiplayer",
      codexModel: "gpt-5.4",
      approvalPolicy: "ask_every_turn",
      messagesSinceLastCodex: 2,
      queuedCodexTurns: Array.from({ length: 6 }, (_, index) => ({
        turnId: `turn-${index}`,
        requestedBy: "Jordan",
        requestedByUserId: "github:jordan",
        queuedAt: "2026-07-04T12:03:00.000Z"
      })),
      attachmentNames: [],
      terminals: [],
      createdAt: "2026-07-04T12:00:00.000Z"
    }).success,
    false
  );
});

test("room settings payloads can report model changes", () => {
  const parsed = RoomSettingsPlaintextPayload.parse({
    eventType: "room.settings",
    id: "settings-1",
    setting: "codexModel",
    previousValue: "gpt-5.4",
    nextValue: "gpt-5.4-thinking",
    changedBy: "Maddie",
    changedByUserId: "github:maddie",
    changedAt: "2026-07-04T12:00:00.000Z"
  });

  assert.equal(parsed.setting, "codexModel");
  assert.equal(parsed.nextValue, "gpt-5.4-thinking");
});

test("room settings payloads cover host-controlled room settings", () => {
  const settings = [
    "roomName",
    "approvalPolicy",
    "approvalDelegationPolicy",
    "trustedApprovers",
    "roomMode",
    "codexModel",
    "projectPath",
    "browserAllowedOrigins",
    "browserProfilePersistent"
  ];

  for (const setting of settings) {
    const parsed = RoomSettingsPlaintextPayload.parse({
      eventType: "room.settings",
      id: `settings-${setting}`,
      setting,
      previousValue: "before",
      nextValue: "after",
      changedBy: "Maddie",
      changedByUserId: "github:maddie",
      changedAt: "2026-07-04T12:00:00.000Z"
    });

    assert.equal(parsed.setting, setting);
  }
});

test("legacy Codex approval payloads remain bounded for backlog compatibility", () => {
  const parsed = CodexApprovalPlaintextPayload.parse({
    eventType: "codex.approval",
    approvalId: "approval-1",
    roomId: "room-desktop",
    approver: "Jordan",
    approverUserId: "github:jordan",
    approvedAt: "2026-07-04T12:00:00.000Z",
    delegationPolicy: "members_can_approve",
    message: "Jordan approved this turn."
  });

  assert.equal(parsed.delegationPolicy, "members_can_approve");
  assert.equal(
    CodexApprovalPlaintextPayload.safeParse({
      ...parsed,
      delegationPolicy: "host_only"
    }).success,
    false
  );
});

test("Codex queue payloads bound room-visible turn queue events", () => {
  const queued = CodexQueuePlaintextPayload.parse({
    eventType: "codex.queue",
    queueEventId: "queue-event-1",
    turnId: "turn-queued-1",
    action: "queued",
    requestedBy: "Jordan",
    requestedByUserId: "github:jordan",
    triggerMessageId: "message-2",
    queuePosition: 2,
    queueSize: 2,
    createdAt: "2026-07-04T12:00:00.000Z"
  });
  const cancelled = CodexQueuePlaintextPayload.parse({
    eventType: "codex.queue",
    queueEventId: "queue-event-2",
    turnId: "turn-queued-1",
    action: "cancelled",
    requestedBy: "Jordan",
    requestedByUserId: "github:jordan",
    reason: "Requester cancelled before host approval.",
    queueSize: 1,
    createdAt: "2026-07-04T12:01:00.000Z"
  });

  assert.equal(queued.queuePosition, 2);
  assert.equal(cancelled.action, "cancelled");
  assert.equal(
    CodexQueuePlaintextPayload.safeParse({
      ...queued,
      queuePosition: undefined
    }).success,
    false
  );
  assert.equal(
    CodexQueuePlaintextPayload.safeParse({
      ...queued,
      queueSize: 6
    }).success,
    false
  );
  assert.equal(
    RelayEnvelope.safeParse({
      id: "envelope-codex-queue-1",
      teamId: "team-core",
      roomId: "room-desktop",
      senderDeviceId: "device-jordan",
      senderUserId: "github:jordan",
      createdAt: "2026-07-04T12:00:00.000Z",
      kind: "codex.queue",
      keyEpoch: 1,
      payload: {
        version: 2,
        algorithm: "AES-GCM-256",
        nonce: "nonce-codex-queue-1",
        ciphertext: "ciphertext"
      }
    }).success,
    true
  );
});

test("Codex turn events can carry bounded risk flags for encrypted audit history", () => {
  const parsed = CodexEventPlaintextPayload.parse({
    eventType: "codex.turn",
    turnId: "turn-1",
    status: "started",
    message: "Started Codex turn with GPT-5.5.",
    model: "gpt-5.5",
    consumedMessageIds: ["message-1", "message-2"],
    riskFlags: [
      {
        id: "message-1:agent-directed-phrasing",
        label: "message from Maddie contains agent-directed phrasing",
        source: "message from Maddie",
        risk: "Agent-directed phrasing",
        severity: "warning"
      }
    ],
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-04T12:00:00.000Z"
  });

  assert.deepEqual(parsed.consumedMessageIds, ["message-1", "message-2"]);
  assert.equal(parsed.riskFlags?.[0]?.risk, "Agent-directed phrasing");
  assert.equal(
    CodexEventPlaintextPayload.safeParse({
      ...parsed,
      riskFlags: Array.from({ length: 25 }, (_, index) => ({
        id: `flag-${index}`,
        label: "too many flags",
        source: "message",
        risk: "risk",
        severity: "warning"
      }))
    }).success,
    false
  );
});

test("invite join request requires capability-authenticated device bindings", () => {
  const parsed = InviteJoinRequestPlaintextPayload.parse({
    eventType: "invite.request",
    id: "device_12345678:request",
    inviteId: "invite-1",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    requesterDeviceId: "device_12345678",
    requesterPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "x-coordinate",
      y: "y-coordinate"
    },
    requesterPublicKeyFingerprint: "sha256:" + "1111:".repeat(15) + "1111",
    hostUserId: "github:host",
    hostDeviceId: "device_host1234",
    hostPublicKeyFingerprint: "sha256:" + "2222:".repeat(15) + "2222",
    keyEpoch: 1,
    requestNonce: "abcdefghijklmnopqrstuv",
    capability: "A".repeat(43),
    capabilityMac: "B".repeat(43),
    requestedAt: "2026-07-04T12:00:00.000Z",
    note: "Requesting access."
  });

  assert.equal(parsed.requesterPublicKeyJwk.kty, "EC");
});

test("invite status accepts capability-authenticated device-wrapped room secret", () => {
  const parsed = InviteJoinStatusPlaintextPayload.parse({
    eventType: "invite.status",
    requestId: "device_12345678:request",
    status: "approved",
    decidedBy: "Host",
    decidedByUserId: "github:host",
    decidedAt: "2026-07-04T12:01:00.000Z",
    recipientUserId: "github:maddie",
    recipientDeviceId: "device_12345678",
    recipientPublicKeyFingerprint: "sha256:" + "1111:".repeat(15) + "1111",
    hostDeviceId: "device_host1234",
    hostPublicKeyFingerprint: "sha256:" + "2222:".repeat(15) + "2222",
    requestNonce: "abcdefghijklmnopqrstuv",
    keyEpoch: 1,
    capabilityMac: "C".repeat(43),
    wrappedRoomSecret: {
      version: 2,
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
      senderPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "ephemeral-x",
        y: "ephemeral-y"
      },
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.wrappedRoomSecret?.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
});

test("legacy invite status without authenticated bindings is rejected", () => {
  const parsed = InviteJoinStatusPlaintextPayload.safeParse({
    eventType: "invite.status",
    requestId: "device_12345678:request",
    status: "denied",
    decidedBy: "Host",
    decidedByUserId: "github:host",
    decidedAt: "2026-07-04T12:01:00.000Z"
  });

  assert.equal(parsed.success, false);
});

test("relay envelope accepts device-sealed invite payloads", () => {
  const parsed = RelayEnvelope.parse({
    id: "envelope-1",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device_12345678",
    senderUserId: "github:maddie",
    createdAt: "2026-07-04T12:02:00.000Z",
    kind: "room.invite",
    keyEpoch: 1,
    payload: {
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
      ephemeralPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "ephemeral-x",
        y: "ephemeral-y"
      },
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.payload.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
});

test("device-sealed and wrapped room secret payloads reject private keys and oversized ciphertext", () => {
  assert.equal(
    RelayEnvelope.safeParse({
      id: "envelope-oversized-sealed",
      teamId: "team-1",
      roomId: "room-1",
      senderDeviceId: "device_12345678",
      senderUserId: "github:maddie",
      createdAt: "2026-07-04T12:02:00.000Z",
      kind: "room.invite",
      payload: {
        algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
        ephemeralPublicKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: "ephemeral-x",
          y: "ephemeral-y",
          d: "private-material"
        },
        nonce: "nonce",
        ciphertext: "ciphertext"
      }
    }).success,
    false
  );

  assert.equal(
    InviteJoinStatusPlaintextPayload.safeParse({
      eventType: "invite.status",
      requestId: "device_12345678:request",
      status: "approved",
      decidedBy: "Host",
      decidedByUserId: "github:host",
      decidedAt: "2026-07-04T12:01:00.000Z",
      recipientDeviceId: "device_12345678",
      recipientPublicKeyFingerprint: "1111:2222:3333:4444:5555:6666:7777:8888",
      wrappedRoomSecret: {
        version: 1,
        algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
        ephemeralPublicKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: "ephemeral-x",
          y: "ephemeral-y"
        },
        nonce: "nonce",
        ciphertext: "x".repeat(maxWrappedCiphertextChars + 1)
      }
    }).success,
    false
  );
});

test("room key rotation payload wraps the new epoch secret once per device", () => {
  const parsed = RoomKeyRotationPlaintextPayload.parse({
    eventType: "room.key.rotated",
    id: "rotation-1",
    rotatedBy: "Host",
    rotatedByUserId: "github:host",
    rotatedAt: "2026-07-04T12:03:00.000Z",
    previousEpoch: 1,
    newEpoch: 2,
    recipients: [
      {
        userId: "github:maddie",
        deviceId: "device_12345678",
        publicKeyFingerprint: "sha256:" + "abcd:".repeat(15) + "abcd",
        wrappedRoomSecret: {
          version: 2,
          algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
          senderPublicKeyJwk: { kty: "EC", crv: "P-256", x: "host-x", y: "host-y" },
          nonce: "nonce",
          ciphertext: "ciphertext"
        }
      }
    ],
    note: "Future messages use this key."
  });

  assert.equal(parsed.newEpoch, 2);
  assert.equal(parsed.recipients.length, 1);
});

test("relay envelope accepts encrypted room key rotation events", () => {
  const parsed = RelayEnvelope.parse({
    id: "envelope-rotation",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device_12345678",
    senderUserId: "github:maddie",
    createdAt: "2026-07-04T12:04:00.000Z",
    kind: "room.key",
    keyEpoch: 1,
    payload: {
      version: 2,
      algorithm: "AES-GCM-256",
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.kind, "room.key");
});

test("local preview payloads and encrypted preview events are bounded", () => {
  const parsed = LocalPreviewPlaintextPayload.parse({
    eventType: "local.preview",
    id: "preview-1",
    sharedBy: "Maddie",
    sharedByUserId: "github:maddie",
    sourceUrl: "http://localhost:5173/",
    publicUrl: "https://demo.trycloudflare.com",
    status: "live",
    message: "Cloudflare is a third-party service.",
    createdAt: "2026-07-06T12:00:00.000Z",
    updatedAt: "2026-07-06T12:01:00.000Z"
  });

  assert.equal(parsed.status, "live");
  assert.equal(
    LocalPreviewPlaintextPayload.safeParse({
      ...parsed,
      sourceUrl: "x".repeat(maxUrlChars + 1)
    }).success,
    false
  );

  const envelope = RelayEnvelope.parse({
    id: "envelope-preview",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device_12345678",
    senderUserId: "github:maddie",
    createdAt: "2026-07-06T12:01:00.000Z",
    kind: "preview.event",
    keyEpoch: 1,
    payload: {
      version: 2,
      algorithm: "AES-GCM-256",
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(envelope.kind, "preview.event");
});

test("workspace file save requests use encrypted workspace envelopes", () => {
  const request = WorkspaceFileSaveRequestPlaintextPayload.parse({
    eventType: "workspace.file.save",
    id: "file-save-1",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    path: "README.md",
    previousContent: "# Old\n",
    nextContent: "# New\n",
    requestedAt: "2026-07-08T12:00:00.000Z"
  });

  assert.equal(request.path, "README.md");
  assert.equal(
    WorkspaceFileSaveRequestPlaintextPayload.safeParse({
      ...request,
      eventType: "workspace.file.delete"
    }).success,
    false
  );

  assert.equal(
    RelayEnvelope.safeParse({
      id: "env-workspace-request",
      teamId: "team-core",
      roomId: "room-desktop",
      senderDeviceId: "device-maddie",
      senderUserId: "github:maddie",
      createdAt: "2026-07-08T12:00:00.000Z",
      kind: "workspace.request",
      keyEpoch: 1,
      payload: {
        version: 2,
        algorithm: "AES-GCM-256",
        nonce: "nonce-file-save-request",
        ciphertext: "encrypted-file-save-request"
      }
    }).success,
    true
  );
  assert.equal(
    RelayEnvelope.safeParse({
      id: "env-workspace-event",
      teamId: "team-core",
      roomId: "room-desktop",
      senderDeviceId: "device-maddie",
      senderUserId: "github:maddie",
      createdAt: "2026-07-08T12:01:00.000Z",
      kind: "workspace.event",
      keyEpoch: 1,
      payload: {
        version: 2,
        algorithm: "AES-GCM-256",
        nonce: "nonce-file-save-status",
        ciphertext: "encrypted-file-save-status"
      }
    }).success,
    true
  );
});

test("decrypted workflow payloads reject unbounded local persistence fields", () => {
  assert.equal(
    TerminalResultPlaintextPayload.safeParse({
      eventType: "terminal.result",
      requestId: "request-1",
      command: "npm test",
      cwd: "/tmp/project",
      exitStatus: 0,
      stdout: "x".repeat(maxLongTextChars + 1),
      stderr: "",
      ranBy: "Host",
      ranByUserId: "github:host",
      startedAt: "2026-07-04T12:00:00.000Z",
      finishedAt: "2026-07-04T12:01:00.000Z"
    }).success,
    false
  );

  assert.equal(
    GitWorkflowEventPlaintextPayload.safeParse({
      eventType: "git.workflow",
      status: "completed",
      branch: "codex/security",
      push: true,
      message: "Done",
      runner: "Host",
      runnerUserId: "github:host",
      createdAt: "2026-07-04T12:00:00.000Z",
      results: Array.from({ length: maxGitWorkflowResults + 1 }, (_, index) => ({
        command: `echo ${index}`,
        cwd: "/tmp/project",
        status: 0,
        stdout: "",
        stderr: ""
      }))
    }).success,
    false
  );

  assert.equal(
    GitHubActionsEventPlaintextPayload.safeParse({
      eventType: "github.actions",
      owner: "maddiedreese",
      repo: "multAIplayer",
      branch: "main",
      summary: { label: "CI", detail: "Too many runs", tone: "yellow" },
      message: "Checked Actions",
      checkedBy: "Host",
      checkedByUserId: "github:host",
      checkedAt: "2026-07-04T12:00:00.000Z",
      runs: Array.from({ length: maxGitHubActionRuns + 1 }, (_, index) => ({
        id: index + 1,
        name: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/maddiedreese/multAIplayer/actions",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:01:00.000Z"
      }))
    }).success,
    false
  );
});

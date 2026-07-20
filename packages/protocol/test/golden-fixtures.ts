import {
  AttachmentBlobRecord,
  BrowserRequestPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  ClientRoomRecord,
  CodexActivityPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  DeviceRecord,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffAcceptedPlaintextPayload,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  InviteJoinRequestRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  KeyPackageUpload,
  LocalPreviewPlaintextPayload,
  MlsRelayMessage,
  PresenceMessage,
  RelayClientMessage,
  RelayHttpErrorResponse,
  RelayServerMessage,
  RequestStatusPlaintextPayload,
  RoomConfigPlaintextPayload,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  TeamMemberRecord,
  TeamRecord,
  TerminalRequestPlaintextPayload,
  TerminalResultPlaintextPayload,
  WorkspaceFileSaveRequestPlaintextPayload
} from "../src/index.js";

export const goldenSchemas = {
  AttachmentBlobRecord,
  BrowserRequestPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  ClientRoomRecord,
  CodexActivityPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  DeviceRecord,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffAcceptedPlaintextPayload,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  InviteJoinRequestRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  KeyPackageUpload,
  LocalPreviewPlaintextPayload,
  MlsRelayMessage,
  PresenceMessage,
  RelayClientMessage,
  RelayHttpErrorResponse,
  RelayServerMessage,
  RequestStatusPlaintextPayload,
  RoomConfigPlaintextPayload,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  TeamMemberRecord,
  TeamRecord,
  TerminalRequestPlaintextPayload,
  TerminalResultPlaintextPayload,
  WorkspaceFileSaveRequestPlaintextPayload
} as const;

export type GoldenSchemaName = keyof typeof goldenSchemas;

export interface GoldenFixtureCase {
  name: string;
  schema: GoldenSchemaName;
  kind?: string;
  json: string;
}

const at = "2026-07-18T12:34:56.000Z";
const fingerprint = `sha256:${Array.from({ length: 16 }, () => "abcd").join(":")}`;
const hash = `sha256:${"b".repeat(64)}`;
const mlsMessage = {
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderDeviceId: "device-1",
  senderUserId: "user-1",
  createdAt: at,
  messageType: "application",
  epochHint: 7,
  mlsMessage: "AA=="
};
const team = { id: "team-1", name: "Core team", members: 2, role: "owner" };
const room = {
  id: "room-1",
  teamId: "team-1",
  acceptedMlsEpoch: 7,
  name: "Protocol room",
  host: "Maddie",
  hostUserId: "user-1",
  activeHostDeviceId: "device-1",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn"
};
const requestStatus = {
  requestId: "request-1",
  status: "approved",
  decidedBy: "Maddie",
  decidedByUserId: "user-1",
  decidedAt: at
};

function fixture(schema: GoldenSchemaName, name: string, value: unknown, kind?: string): GoldenFixtureCase {
  const parsed = goldenSchemas[schema].parse(value);
  return { name, schema, ...(kind ? { kind } : {}), json: JSON.stringify(parsed) };
}

export function buildGoldenFixtureDocument() {
  const cases: GoldenFixtureCase[] = [
    fixture("RelayClientMessage", "client-join", {
      type: "join",
      teamId: "team-1",
      roomId: "room-1",
      userId: "user-1",
      deviceId: "device-1",
      inviteId: "invite-1",
      deviceSessionToken: "s".repeat(32)
    }),
    fixture("RelayClientMessage", "client-subscribe-team", {
      type: "subscribe.team",
      teamId: "team-1",
      userId: "user-1",
      deviceId: "device-1"
    }),
    fixture("RelayClientMessage", "client-subscribe-workspace", {
      type: "subscribe.workspace",
      userId: "user-1",
      deviceId: "device-1"
    }),
    fixture("RelayClientMessage", "client-publish", { type: "publish", message: mlsMessage }),
    fixture("RelayClientMessage", "client-presence", {
      type: "presence",
      teamId: "team-1",
      roomId: "room-1",
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Maddie",
      avatarUrl: "https://example.test/avatar",
      publicKeyFingerprint: fingerprint
    }),
    fixture("RelayServerMessage", "server-joined", { type: "joined", teamId: "team-1", roomId: "room-1" }),
    fixture("RelayServerMessage", "server-team-subscribed", { type: "team.subscribed", teamId: "team-1" }),
    fixture("RelayServerMessage", "server-workspace-subscribed", { type: "workspace.subscribed" }),
    fixture("RelayServerMessage", "server-invite-requested", {
      type: "invite.requested",
      inviteId: "invite-1",
      requestId: "request-1"
    }),
    fixture("RelayServerMessage", "server-published", { type: "published", messageId: "message-1" }),
    fixture("RelayServerMessage", "server-mls-message", { type: "mls.message", message: mlsMessage }),
    fixture("RelayServerMessage", "server-presence", {
      type: "presence",
      teamId: "team-1",
      roomId: "room-1",
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Maddie",
      status: "online"
    }),
    fixture("RelayServerMessage", "server-room-updated", { type: "room.updated", room }),
    fixture("RelayServerMessage", "server-team-updated", { type: "team.updated", team }),
    fixture("RelayServerMessage", "server-error", {
      type: "error",
      message: "stale",
      code: "stale_epoch",
      messageId: "message-1",
      teamId: "team-1",
      roomId: "room-1"
    }),
    fixture("MlsRelayMessage", "mls-application", mlsMessage),
    fixture("MlsRelayMessage", "mls-host-handoff", {
      ...mlsMessage,
      messageType: "commit",
      commitEffect: "host_handoff",
      nextHostUserId: "user-2",
      nextHostDeviceId: "device-2",
      hostTransferAuthorization: {
        version: 2,
        transferId: "transfer-1",
        roomId: "room-1",
        commitMessageId: "a".repeat(64),
        parentEpoch: 7,
        outgoingHostUserId: "user-1",
        outgoingHostDeviceId: "device-1",
        nextHostUserId: "user-2",
        nextHostDeviceId: "device-2",
        nextHostLeaf: 1,
        signatureDer: "AA==",
        publicKeySpkiDer: "AA=="
      }
    }),
    fixture("KeyPackageUpload", "key-package-upload", {
      id: "package-1",
      keyPackage: "AA==",
      keyPackageHash: hash,
      ciphersuite: 2
    }),
    fixture("KeyPackageRecord", "key-package-record", {
      id: "package-1",
      keyPackage: "AA==",
      keyPackageHash: hash,
      ciphersuite: 2,
      userId: "user-1",
      deviceId: "device-1",
      credentialIdentity: "credential-1",
      createdAt: at
    }),
    fixture("PresenceMessage", "presence-record", {
      type: "presence",
      teamId: "team-1",
      roomId: "room-1",
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Maddie",
      publicKeyFingerprint: fingerprint
    }),
    fixture("RelayHttpErrorResponse", "http-error-passthrough", {
      error: "Slow down.",
      code: "rate_limited",
      retryAfterSeconds: 5
    }),
    fixture("TeamRecord", "team-record", team),
    fixture("TeamMemberRecord", "team-member-record", {
      teamId: "team-1",
      userId: "user-1",
      role: "admin",
      joinedAt: at
    }),
    fixture("DeviceRecord", "device-record", {
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Maddie",
      signaturePublicKey: "signature-key",
      signatureKeyFingerprint: fingerprint,
      hpkePublicKey: "hpke-key",
      hpkeKeyFingerprint: fingerprint,
      registeredAt: at,
      lastSeenAt: at
    }),
    fixture("RoomRecord", "room-record", room),
    fixture("ClientRoomRecord", "client-room-record", {
      ...room,
      projectPath: "/tmp/project",
      codexModel: "gpt-5.6-sol",
      codexModelPolicy: "auto",
      codexReasoningEffort: "medium",
      codexReasoningEffortPolicy: "auto",
      codexRawReasoningEnabled: false,
      codexSpeed: "standard",
      codexServiceTierPolicy: "auto",
      codexSandboxLevel: "workspace_write",
      configRevision: 1,
      configEpoch: 7,
      configPending: false,
      unread: 0
    }),
    fixture("InviteRecord", "invite-record", {
      id: "invite-1",
      teamId: "team-1",
      roomId: "room-1",
      creatorUserId: "user-1",
      createdAt: at,
      expiresAt: at
    }),
    fixture("InviteJoinRequestRecord", "invite-join-request", {
      requestId: "request-1",
      inviteId: "invite-1",
      requesterUserId: "user-2",
      requesterDeviceId: "device-2",
      keyPackageId: "package-1",
      keyPackageHash: hash,
      sealedRequest: "AA==",
      createdAt: at
    }),
    fixture("InviteResponseRecord", "invite-response", {
      requestId: "request-1",
      inviteId: "invite-1",
      requesterUserId: "user-2",
      requesterDeviceId: "device-2",
      keyPackageHash: hash,
      status: "approved",
      responseBinding: {
        version: 3,
        phase: "response",
        inviteId: "invite-1",
        teamId: "team-1",
        roomId: "room-1",
        keyEpoch: 7,
        keyPackageHash: hash,
        requestId: "request-1",
        requestNonce: "nonce-1",
        requesterUserId: "user-2",
        requesterDeviceId: "device-2",
        hostUserId: "user-1",
        hostDeviceId: "device-1",
        expiresAt: at,
        status: "approved",
        decidedAt: at
      },
      responseMac: "AA==",
      welcome: "AA==",
      createdAt: at
    }),
    fixture("AttachmentBlobRecord", "attachment-record", {
      id: "blob-1",
      teamId: "team-1",
      roomId: "room-1",
      name: "note.txt",
      type: "text/plain",
      size: 5,
      uploadedByUserId: "user-1",
      epoch: 7,
      sealedBlob: "AA==",
      createdAt: at
    }),
    fixture(
      "ChatPlaintextPayload",
      "chat-message",
      {
        id: "chat-1",
        author: "Maddie",
        authorUserId: "user-1",
        role: "human",
        body: "Hello",
        time: "12:34",
        createdAt: at,
        attachments: [{ id: "attachment-1", name: "note.txt", type: "text/plain", size: 5, content: "hello" }]
      },
      "chat.message"
    ),
    fixture(
      "ChatReactionPlaintextPayload",
      "chat-reaction",
      {
        id: "reaction-1",
        messageId: "chat-1",
        emoji: "👍",
        action: "add",
        reactor: "Maddie",
        reactorUserId: "user-1",
        createdAt: at
      },
      "chat.reaction"
    ),
    fixture(
      "ChatEditPlaintextPayload",
      "chat-edit",
      {
        id: "edit-1",
        messageId: "chat-1",
        body: "Hello again",
        editedBy: "Maddie",
        editedByUserId: "user-1",
        editedAt: at
      },
      "chat.edit"
    ),
    fixture(
      "ChatDeletePlaintextPayload",
      "chat-delete",
      {
        id: "delete-1",
        messageId: "chat-1",
        deletedBy: "Maddie",
        deletedByUserId: "user-1",
        deletedAt: at
      },
      "chat.delete"
    ),
    fixture(
      "TerminalRequestPlaintextPayload",
      "terminal-request",
      {
        id: "request-1",
        requester: "Maddie",
        requesterUserId: "user-1",
        command: "cargo test",
        cwd: "/tmp/project",
        requestedAt: at
      },
      "terminal.request"
    ),
    fixture(
      "TerminalResultPlaintextPayload",
      "terminal-result",
      {
        eventType: "terminal.result",
        requestId: "request-1",
        command: "cargo test",
        cwd: "/tmp/project",
        exitStatus: 0,
        stdout: "ok",
        stderr: "",
        ranBy: "Maddie",
        ranByUserId: "user-1",
        startedAt: at,
        finishedAt: at
      },
      "terminal.event"
    ),
    fixture("RequestStatusPlaintextPayload", "terminal-status", requestStatus, "terminal.event"),
    fixture(
      "BrowserRequestPlaintextPayload",
      "browser-request",
      {
        id: "browser-1",
        requester: "Maddie",
        requesterUserId: "user-1",
        url: "https://example.test",
        reason: "Docs",
        requestedAt: at
      },
      "browser.request"
    ),
    fixture("RequestStatusPlaintextPayload", "browser-status", requestStatus, "browser.event"),
    fixture(
      "WorkspaceFileSaveRequestPlaintextPayload",
      "workspace-request",
      {
        eventType: "workspace.file.save",
        id: "save-1",
        requester: "Maddie",
        requesterUserId: "user-1",
        path: "src/lib.rs",
        previousContent: "old",
        nextContent: "new",
        requestedAt: at
      },
      "workspace.request"
    ),
    fixture("RequestStatusPlaintextPayload", "workspace-status", requestStatus, "workspace.event"),
    fixture(
      "LocalPreviewPlaintextPayload",
      "preview-event",
      {
        eventType: "local.preview",
        id: "preview-1",
        sharedBy: "Maddie",
        sharedByUserId: "user-1",
        sourceUrl: "http://localhost:3000",
        status: "live",
        createdAt: at,
        updatedAt: at
      },
      "preview.event"
    ),
    fixture(
      "CodexEventPlaintextPayload",
      "codex-event",
      {
        eventType: "codex.turn",
        turnId: "turn-1",
        status: "completed",
        message: "Done",
        model: "gpt-5.6-sol",
        host: "Maddie",
        hostUserId: "user-1",
        createdAt: at
      },
      "codex.event"
    ),
    fixture(
      "CodexActivityPlaintextPayload",
      "codex-activity",
      {
        eventType: "codex.activity",
        activityId: "activity-1",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "reasoning",
        status: "completed",
        title: "Reasoning",
        details: { type: "reasoning", summaries: ["Checked parity."] },
        startedAt: at,
        updatedAt: at,
        host: "Maddie",
        hostUserId: "user-1"
      },
      "codex.activity"
    ),
    fixture(
      "CodexQueuePlaintextPayload",
      "codex-queue",
      {
        eventType: "codex.queue",
        queueEventId: "queue-1",
        turnId: "turn-1",
        action: "queued",
        requestedBy: "Maddie",
        requestedByUserId: "user-1",
        queuePosition: 1,
        queueSize: 1,
        createdAt: at
      },
      "codex.queue"
    ),
    fixture(
      "GitWorkflowEventPlaintextPayload",
      "git-workflow",
      {
        eventType: "git.workflow",
        status: "completed",
        branch: "feature/cli-improvements",
        push: false,
        message: "Passed",
        runner: "Maddie",
        runnerUserId: "user-1",
        createdAt: at,
        results: [{ command: "git diff --check", cwd: "/tmp/project", status: 0, stdout: "", stderr: "" }]
      },
      "git.event"
    ),
    fixture(
      "GitHubActionsEventPlaintextPayload",
      "github-actions",
      {
        eventType: "github.actions",
        owner: "owner",
        repo: "repo",
        branch: "main",
        summary: { label: "Passing", detail: "All checks passed", tone: "green" },
        message: "Passing",
        checkedBy: "Maddie",
        checkedByUserId: "user-1",
        checkedAt: at,
        runs: [
          {
            id: 1,
            name: "test",
            status: "completed",
            conclusion: "success",
            url: "https://example.test/run",
            createdAt: at,
            updatedAt: at
          }
        ]
      },
      "git.event"
    ),
    fixture(
      "HostHandoffPlaintextPayload",
      "host-handoff",
      {
        id: "handoff-1",
        fromHost: "Maddie",
        fromUserId: "user-1",
        reason: "manual",
        projectPath: "/tmp/project",
        codexModel: "gpt-5.6-sol",
        codexModelPolicy: "auto",
        codexReasoningEffort: "medium",
        codexReasoningEffortPolicy: "auto",
        codexRawReasoningEnabled: false,
        codexSpeed: "standard",
        codexServiceTierPolicy: "auto",
        codexSandboxLevel: "workspace_write",
        approvalPolicy: "ask_every_turn",
        messagesSinceLastCodex: 0,
        queuedCodexTurns: [],
        attachmentNames: [],
        terminals: [],
        createdAt: at,
        status: "available"
      },
      "room.host"
    ),
    fixture(
      "HostHandoffRequestPlaintextPayload",
      "host-handoff-request",
      {
        phase: "candidate_request",
        offerId: "handoff-1",
        candidateUserId: "user-2",
        candidateDeviceId: "device-2",
        candidateLeaf: 1
      },
      "room.host.request"
    ),
    fixture(
      "HostHandoffAcceptedPlaintextPayload",
      "host-handoff-accepted",
      {
        phase: "accepted",
        offerId: "handoff-1",
        hostUserId: "user-2",
        hostDeviceId: "device-2",
        hostLeaf: 1,
        committedEpoch: 8
      },
      "room.host.accepted"
    ),
    fixture(
      "RoomSettingsPlaintextPayload",
      "room-settings",
      {
        eventType: "room.settings",
        id: "settings-1",
        setting: "roomName",
        previousValue: "Old",
        nextValue: "New",
        changedBy: "Maddie",
        changedByUserId: "user-1",
        changedAt: at
      },
      "room.settings"
    ),
    fixture(
      "RoomConfigPlaintextPayload",
      "room-config",
      {
        eventType: "room.config",
        configRevision: 1,
        emittingEpoch: 7,
        projectPath: "/tmp/project",
        codexModel: "gpt-5.6-sol",
        codexModelPolicy: "auto",
        codexReasoningEffort: "medium",
        codexReasoningEffortPolicy: "auto",
        codexRawReasoningEnabled: false,
        codexSpeed: "standard",
        codexServiceTierPolicy: "auto",
        codexSandboxLevel: "workspace_write"
      },
      "room.config"
    )
  ];
  return { version: 1, authority: "packages/protocol Zod schemas", cases };
}

export function renderGoldenFixtureFile(): string {
  return `${JSON.stringify(buildGoldenFixtureDocument(), null, 2)}\n`;
}

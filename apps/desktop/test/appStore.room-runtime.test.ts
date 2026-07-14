import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";
import { projectGitHubActionsByRoom, projectGitWorkflowByRoom } from "../src/store/slices/gitWorkflowSlice";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("desktop store keeps room runtime state room scoped", () => {
  const store = useAppStore.getState();

  store.setInspectorTabForRoom("room-a", "files");
  store.setInspectorTabForRoom("room-b", "terminal");
  store.setRoomPresenceForDevice("room-a", "device-a", {
    userId: "github:avery",
    deviceId: "device-a",
    displayName: "Avery",
    status: "online"
  });
  store.setRoomPresenceForDevice("room-b", "device-b", {
    userId: "github:jordan",
    deviceId: "device-b",
    displayName: "Jordan",
    status: "online"
  });
  store.clearPresenceForRoom("room-a");
  store.appendHostHandoff("room-a", {
    id: "handoff-1",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "usage_limit",
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
    codexModel: "GPT-5.4",
    approvalPolicy: "Ask every Codex turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 3,
    attachmentNames: ["docs/checklist.md"],
    terminals: ["shell"],
    createdAt: "2026-07-06T00:10:00.000Z",
    status: "available"
  });
  store.setCodexContinuationForRoom("room-b", {
    id: "handoff-2",
    fromHost: "Avery",
    fromUserId: "github:avery",
    projectPath: "/Users/avery/project",
    codexModel: "GPT-5.4",
    approvalPolicy: "Ask every Codex turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 1,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:11:00.000Z",
    status: "accepted",
    acceptedBy: "Jordan",
    acceptedByUserId: "github:jordan",
    acceptedAt: "2026-07-06T00:12:00.000Z"
  });
  store.appendGitWorkflowEvent("room-a", {
    eventType: "git.workflow",
    status: "completed",
    branch: "codex/runtime-state",
    push: true,
    message: "Opened draft PR",
    runner: "Maddie",
    runnerUserId: "github:maddie",
    createdAt: "2026-07-06T00:13:00.000Z"
  });
  store.appendGitHubActionsEvent("room-b", {
    eventType: "github.actions",
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "main",
    summary: { label: "CI", detail: "All checks passed", tone: "green" },
    message: "Checked Actions",
    checkedBy: "Maddie",
    checkedByUserId: "github:maddie",
    checkedAt: "2026-07-06T00:14:00.000Z",
    runs: [
      {
        id: 18,
        name: "Web, relay, and packages",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/maddiedreese/multAIplayer/actions/runs/18",
        createdAt: "2026-07-06T00:13:00.000Z",
        updatedAt: "2026-07-06T00:14:00.000Z"
      }
    ]
  });

  const state = useAppStore.getState();
  assert.equal(state.historyPresenceByRoom["room-a"]?.inspectorTab, "files");
  assert.equal(state.historyPresenceByRoom["room-b"]?.inspectorTab, "terminal");
  assert.equal(state.historyPresenceByRoom["room-a"]?.presence, undefined);
  assert.equal(state.historyPresenceByRoom["room-b"]?.presence?.["device-b"]?.displayName, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.reason, "usage_limit");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.continuation?.acceptedBy, "Jordan");
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.branch,
    "codex/runtime-state"
  );
  assert.equal(
    projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.events?.[0]?.summary.tone,
    "green"
  );
});

test("desktop store exposes room presence actions", () => {
  const store = useAppStore.getState();

  store.setRoomPresenceForDevice("room-a", "device-a", {
    userId: "github:maddie",
    deviceId: "device-a",
    displayName: "Maddie",
    publicKeyFingerprint: "1234:abcd",
    status: "online"
  });
  store.setRoomPresenceForDevice("room-b", "device-b", {
    userId: "github:jordan",
    deviceId: "device-b",
    displayName: "Jordan",
    status: "online"
  });
  store.setRoomPresenceForDevice("room-a", "device-a", null);

  let state = useAppStore.getState();
  assert.deepEqual(state.historyPresenceByRoom["room-a"]?.presence, {});
  assert.equal(state.historyPresenceByRoom["room-b"]?.presence?.["device-b"]?.displayName, "Jordan");

  store.clearPresenceByRoom();

  state = useAppStore.getState();
  assert.deepEqual(state.historyPresenceByRoom, {});
});

test("desktop store exposes room event append actions", () => {
  const store = useAppStore.getState();
  const gitEvent = {
    eventType: "git.workflow" as const,
    status: "completed" as const,
    branch: "codex/events",
    push: true,
    message: "Opened draft PR",
    runner: "Maddie",
    runnerUserId: "github:maddie",
    createdAt: "2026-07-06T00:13:00.000Z"
  };
  const actionsEvent = {
    eventType: "github.actions" as const,
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "main",
    summary: { label: "CI", detail: "All checks passed", tone: "green" as const },
    message: "Checked Actions",
    checkedBy: "Maddie",
    checkedByUserId: "github:maddie",
    checkedAt: "2026-07-06T00:14:00.000Z",
    runs: []
  };
  const localPreview = {
    eventType: "local.preview" as const,
    id: "preview-1",
    sharedBy: "Maddie",
    sharedByUserId: "github:maddie",
    sourceUrl: "http://127.0.0.1:5173",
    status: "starting" as const,
    createdAt: "2026-07-06T00:15:00.000Z",
    updatedAt: "2026-07-06T00:15:00.000Z"
  };
  const handoff = {
    id: "handoff-1",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "usage_limit" as const,
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
    codexModel: "gpt-5.4",
    approvalPolicy: "ask",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 4,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:16:00.000Z",
    status: "available" as const
  };
  const inviteRequest = {
    eventType: "invite.request" as const,
    id: "invite-request-1",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    requesterDeviceId: "device-jordan",
    requestedAt: "2026-07-06T00:17:00.000Z",
    status: "pending" as const
  };
  const codexEvent = {
    eventType: "codex.turn" as const,
    turnId: "turn-1",
    status: "event" as const,
    message: "Reading context",
    model: "gpt-5.4",
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-06T00:18:00.000Z"
  };

  store.appendGitWorkflowEvent("room-a", gitEvent);
  store.appendGitWorkflowEvent("room-a", gitEvent);
  store.appendGitHubActionsEvent("room-a", actionsEvent);
  store.appendGitHubActionsEvent("room-a", actionsEvent);
  store.appendLocalPreviewEvent("room-a", localPreview);
  store.appendLocalPreviewEvent("room-a", { ...localPreview, status: "live", updatedAt: "2026-07-06T00:16:00.000Z" });
  store.appendHostHandoff("room-a", handoff);
  store.appendHostHandoff("room-a", handoff);
  store.appendInviteRequest("room-a", inviteRequest);
  store.appendInviteRequest("room-a", inviteRequest);
  store.appendCodexEvent("room-a", codexEvent);
  store.appendCodexEvent("room-a", codexEvent);

  const state = useAppStore.getState();
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.length, 1);
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.length, 1);
  assert.equal(state.localPreviewByRoom["room-a"]?.previews?.length, 1);
  assert.equal(state.localPreviewByRoom["room-a"]?.previews?.[0]?.status, "live");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.length, 1);
  assert.equal(state.inviteByRoom["room-a"]?.requests?.length, 1);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.events?.length, 1);
});

test("desktop store exposes host handoff actions", () => {
  const store = useAppStore.getState();
  const olderHandoff = {
    id: "handoff-older",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "manual" as const,
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
    codexModel: "gpt-5.4",
    approvalPolicy: "ask",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 1,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:15:00.000Z",
    status: "available" as const
  };
  const latestHandoff = {
    ...olderHandoff,
    id: "handoff-latest",
    reason: "usage_limit" as const,
    messagesSinceLastCodex: 4,
    createdAt: "2026-07-06T00:16:00.000Z"
  };

  store.appendHostHandoff("room-a", olderHandoff);
  store.appendHostHandoff("room-a", latestHandoff);
  store.markHostHandoffAcceptedForRoom("room-a", olderHandoff.id);
  store.setCodexContinuationForRoom("room-a", latestHandoff);

  let state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.status, "accepted");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[1]?.status, "available");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.continuation?.id, latestHandoff.id);

  store.markLatestHostHandoffAcceptedForRoom("room-a");
  store.setCodexContinuationForRoom("room-a", null);

  state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[1]?.status, "accepted");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.continuation, undefined);
});

test("desktop store preserves accepted host handoffs that arrive before available handoffs", () => {
  const store = useAppStore.getState();
  const acceptedHandoff = {
    id: "handoff-accepted-first",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "usage_limit" as const,
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
    codexModel: "gpt-5.4",
    approvalPolicy: "ask",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 4,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:16:00.000Z",
    status: "accepted" as const,
    acceptedBy: "Jordan",
    acceptedByUserId: "github:jordan",
    acceptedAt: "2026-07-06T00:17:00.000Z"
  };

  store.applyAcceptedHostHandoffForRoom("room-a", acceptedHandoff);
  store.appendHostHandoff("room-a", { ...acceptedHandoff, status: "available" });

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.length, 1);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.status, "accepted");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.acceptedBy, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.acceptedAt, "2026-07-06T00:17:00.000Z");
});

test("desktop store keeps terminal panel state room scoped", () => {
  const store = useAppStore.getState();

  store.seedInitialTerminalLines({
    "room-a": ["system $ npm run dev", "stdout Ready"],
    "room-b": ["system $ git status"]
  });
  store.setTerminalBusyForRoom("room-a", true);
  store.setTerminalBusyForRoom("room-b", false);
  store.upsertTerminalSnapshot({
    id: "terminal-a",
    roomId: "room-a",
    name: "shell",
    cwd: "/Users/maddiedreese/Documents/MultAIplayer",
    command: "zsh -l",
    running: true,
    exitStatus: null,
    startedAt: "2026-07-06T00:15:00.000Z",
    lines: [{ stream: "system", text: "$ zsh -l" }]
  });
  store.appendTerminalRequest("room-b", {
    id: "terminal-request-1",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    command: "npm test",
    cwd: "/Users/jordan/project",
    requestedAt: "2026-07-06T00:16:00.000Z",
    status: "pending"
  });
  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setSelectedTerminalIdForRoom("room-b", null);
  store.setTerminalErrorForRoom("room-a", null);
  store.setTerminalErrorForRoom("room-b", "Host approval required");

  const state = useAppStore.getState();
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.lines?.[1], "stdout Ready");
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.busy, true);
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.busy, undefined);
  assert.equal(state.terminals[0]?.name, "shell");
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.requests?.[0]?.command, "npm test");
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.selectedTerminalId, "terminal-a");
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.selectedTerminalId, undefined);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.ui, undefined);
  assert.deepEqual(state.terminalRuntimeByRoom["room-b"]?.ui, {
    error: "Host approval required"
  });
});

test("desktop store exposes room terminal actions", () => {
  const store = useAppStore.getState();

  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setTerminalErrorForRoom("room-a", "Host approval required");
  store.appendTerminalLinesForRoom("room-a", ["one", "two"], 3);
  store.appendTerminalLinesForRoom("room-a", ["three", "four"], 3);
  store.setSelectedTerminalIdForRoom("room-b", null);
  store.setTerminalErrorForRoom("room-a", null);

  const state = useAppStore.getState();
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.selectedTerminalId, "terminal-a");
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.selectedTerminalId, undefined);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.ui, undefined);
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.ui, undefined);
  assert.deepEqual(state.terminalRuntimeByRoom["room-a"]?.lines, ["two", "three", "four"]);
});

test("desktop store clears local room-scoped state", () => {
  const store = useAppStore.getState();

  store.appendRoomMessage("room-a", { id: "message-a", author: "Avery", role: "human", body: "hello", time: "9:41" });
  store.appendRoomMessage("room-b", { id: "message-b", author: "Jordan", role: "human", body: "keep", time: "9:42" });
  store.editRoomMessage("room-a", {
    id: "edit-clear",
    messageId: "message-a",
    body: "hello edited",
    editedBy: "Avery",
    editedByUserId: "github:avery",
    editedAt: "2026-07-06T00:19:00.000Z"
  });
  store.deleteRoomMessage("room-a", {
    id: "delete-clear",
    messageId: "message-a",
    deletedBy: "Avery",
    deletedByUserId: "github:avery",
    deletedAt: "2026-07-06T00:19:30.000Z"
  });
  store.appendTerminalRequest("room-a", {
    id: "terminal-request-room-a",
    requester: "Avery",
    requesterUserId: "github:avery",
    command: "npm test",
    cwd: "/tmp/a",
    requestedAt: "2026-07-06T00:20:00.000Z",
    status: "pending"
  });
  store.appendTerminalRequest("room-b", {
    id: "terminal-request-room-b",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    command: "npm run dev",
    cwd: "/tmp/b",
    requestedAt: "2026-07-06T00:21:00.000Z",
    status: "pending"
  });
  store.appendBrowserRequest("room-a", {
    id: "browser-request-room-a",
    requester: "Avery",
    requesterUserId: "github:avery",
    url: "https://github.com",
    reason: "Review",
    requestedAt: "2026-07-06T00:20:00.000Z",
    status: "pending"
  });
  store.appendBrowserRequest("room-b", {
    id: "browser-request-room-b",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    url: "https://example.com",
    reason: "Keep",
    requestedAt: "2026-07-06T00:21:00.000Z",
    status: "pending"
  });
  store.setInviteRequestsForRoom("room-a", []);
  store.setInviteRequestsForRoom("room-b", []);
  store.appendCodexEvent("room-a", {
    eventType: "codex.turn",
    turnId: "turn-a",
    status: "started",
    createdAt: "2026-07-06T00:23:00.000Z"
  });
  store.appendCodexEvent("room-b", {
    eventType: "codex.turn",
    turnId: "turn-b",
    status: "started",
    createdAt: "2026-07-06T00:24:00.000Z"
  });
  store.appendGitWorkflowEvent("room-b", {
    eventType: "git.workflow",
    status: "completed",
    branch: "codex/keep",
    push: true,
    message: "Keep this event",
    runner: "Maddie",
    runnerUserId: "github:maddie",
    createdAt: "2026-07-06T00:25:00.000Z"
  });
  store.appendGitHubActionsEvent("room-b", {
    eventType: "github.actions",
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "main",
    summary: { label: "CI", detail: "Keep", tone: "green" },
    message: "Keep this event",
    checkedBy: "Maddie",
    checkedByUserId: "github:maddie",
    checkedAt: "2026-07-06T00:26:00.000Z",
    runs: []
  });
  store.appendHostHandoff("room-b", {
    id: "handoff-keep",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    projectPath: "/tmp/b",
    codexModel: "GPT-5.4",
    approvalPolicy: "Ask every Codex turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 1,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:27:00.000Z",
    status: "available"
  });
  store.setCodexThreadIdForRoom("room-a", "thread-a");
  store.setCodexThreadIdForRoom("room-b", "thread-b");
  store.recordGitHubActionsRefreshForRoom("room-a", {
    runs: [],
    checkedAt: "now",
    message: "Checking"
  });
  store.recordGitHubActionsRefreshForRoom("room-b", {
    runs: [],
    checkedAt: "later",
    message: "Keep"
  });
  store.setActionsLastCheckedForRoom("room-a", "now");
  store.setActionsLastCheckedForRoom("room-b", "later");
  store.setActionsMessageForRoom("room-a", "Checking");
  store.setActionsMessageForRoom("room-b", "Keep");
  store.setGitWorkflowBusyForRoom("room-a", true);
  store.setGitWorkflowBusyForRoom("room-b", true);
  store.setHostMessageForRoom("room-a", "Host busy");
  store.setHostMessageForRoom("room-b", "Keep");
  store.setSecretWarningVisibleForRoom("room-a", true);
  store.setSecretWarningVisibleForRoom("room-b", true);
  store.setHistorySearchResultsByRoom({
    "room-a": [
      {
        id: "history-search-a",
        author: "Avery",
        role: "human",
        body: "Clear search result",
        time: "10:01"
      }
    ],
    "room-b": [
      {
        id: "history-search-b",
        author: "Jordan",
        role: "human",
        body: "Keep search result",
        time: "10:02"
      }
    ]
  });
  store.setInspectorTabForRoom("room-a", "browser");
  store.setInspectorTabForRoom("room-b", "terminal");
  store.setRoomPresenceForDevice("room-a", "device-a", {
    roomId: "room-a",
    deviceId: "device-a",
    displayName: "Avery",
    userId: "github:avery",
    lastSeenAt: "2026-07-06T00:28:00.000Z"
  });
  store.setRoomPresenceForDevice("room-b", "device-b", {
    roomId: "room-b",
    deviceId: "device-b",
    displayName: "Jordan",
    userId: "github:jordan",
    lastSeenAt: "2026-07-06T00:29:00.000Z"
  });
  store.setCodexContinuationForRoom("room-a", {
    id: "handoff-clear",
    fromHost: "Avery",
    fromUserId: "github:avery",
    projectPath: "/tmp/a",
    codexModel: "GPT-5.4",
    approvalPolicy: "Ask every Codex turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 2,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:30:00.000Z",
    status: "accepted",
    acceptedBy: "Avery",
    acceptedByUserId: "github:avery",
    acceptedAt: "2026-07-06T00:31:00.000Z"
  });
  store.setCodexContinuationForRoom("room-b", {
    id: "handoff-continue",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    projectPath: "/tmp/b",
    codexModel: "GPT-5.4",
    approvalPolicy: "Ask every Codex turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    messagesSinceLastCodex: 3,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:32:00.000Z",
    status: "accepted",
    acceptedBy: "Jordan",
    acceptedByUserId: "github:jordan",
    acceptedAt: "2026-07-06T00:33:00.000Z"
  });
  store.toggleSelectedMessageForRoom("room-a", "message-a");
  store.toggleSelectedMessageForRoom("room-b", "message-b");
  store.setProjectFilesForRoom("room-a", [{ path: "README.md", size: 1 }]);
  store.setProjectFilesForRoom("room-b", []);
  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setSelectedTerminalIdForRoom("room-b", "terminal-b");
  store.syncTerminalSnapshotsForRoom("room-a", [
    {
      id: "terminal-a",
      roomId: "room-a",
      name: "shell",
      cwd: "/tmp/a",
      command: "zsh -l",
      status: "running",
      output: []
    }
  ]);
  store.syncTerminalSnapshotsForRoom("room-b", [
    {
      id: "terminal-b",
      roomId: "room-b",
      name: "shell",
      cwd: "/tmp/b",
      command: "zsh -l",
      status: "running",
      output: []
    }
  ]);
  store.setBrowserUrlForRoom("room-a", "https://github.com", "http://localhost:3000");
  store.setBrowserUrlForRoom("room-b", "https://example.com", "http://localhost:3000");
  store.setDraftForRoom("room-a", "clear me");
  store.setDraftForRoom("room-b", "keep me");
  store.setSensitiveAttachmentReviewKey("room-a:.env");

  store.clearRoomScopedStateForRoom("room-a");

  const state = useAppStore.getState();
  assert.deepEqual(state.messagesByRoom["room-a"], []);
  assert.deepEqual(state.chatEditsByRoom["room-a"], []);
  assert.deepEqual(state.chatDeletesByRoom["room-a"], []);
  assert.deepEqual(state.terminalRuntimeByRoom["room-a"]?.requests, []);
  assert.deepEqual(state.browserByRoom["room-a"], { requests: [] });
  assert.equal(state.inviteByRoom["room-a"], undefined);
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.events, []);
  assert.deepEqual(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"], { events: [] });
  assert.deepEqual(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events, []);
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.hostHandoffs, []);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadGraph, undefined);
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.runs, undefined);
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.busy, undefined);
  assert.equal(state.roomSettingsByRoom["room-a"], undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.secretWarningVisible, undefined);
  assert.equal(state.historyPresenceByRoom["room-a"]?.searchMessages, undefined);
  assert.equal(state.historyPresenceByRoom["room-a"]?.inspectorTab, undefined);
  assert.equal(state.historyPresenceByRoom["room-a"]?.presence, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.continuation, undefined);
  assert.equal(state.roomChatByRoom["room-a"], undefined);
  assert.equal(state.sensitiveAttachmentReviewKey, null);
  assert.equal(state.filePanelByRoom["room-a"], undefined);
  assert.equal(state.localPreviewByRoom["room-a"], undefined);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.selectedTerminalId, undefined);
  assert.equal(
    state.terminals.some((terminal) => terminal.roomId === "room-a"),
    false
  );
  assert.equal(state.browserByRoom["room-a"]?.url, undefined);
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "keep");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.events?.[0]?.turnId, "turn-b");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.threadGraph?.activeThreadId, "thread-b");
  assert.equal(state.historyPresenceByRoom["room-b"]?.searchMessages?.[0]?.body, "Keep search result");
  assert.equal(state.historyPresenceByRoom["room-b"]?.inspectorTab, "terminal");
  assert.equal(state.historyPresenceByRoom["room-b"]?.presence?.["device-b"]?.displayName, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.continuation?.acceptedBy, "Jordan");
  assert.deepEqual(state.roomChatByRoom["room-b"]?.selectedMessageIds, ["message-b"]);
  assert.equal(
    state.terminals.some((terminal) => terminal.roomId === "room-b"),
    true
  );
  assert.equal(state.browserByRoom["room-b"]?.url, "https://example.com");
});

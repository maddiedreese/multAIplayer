import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";
import { projectGitHubActionsByRoom, projectGitWorkflowByRoom } from "../src/store/slices/gitWorkflowSlice";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("desktop store keeps workspace maps scoped", () => {
  const store = useAppStore.getState();

  store.setTeamMembersForTeam("team-core", [
    {
      teamId: "team-core",
      userId: "github:maddie",
      role: "owner",
      joinedAt: "2026-07-06T00:17:00.000Z"
    }
  ]);
  store.setTeamMembersForTeam("team-labs", []);
  store.setTeamMembersMessageForTeam("team-core", null);
  store.setTeamMembersMessageForTeam("team-labs", "Could not refresh members");
  store.setTeamMembersBusyForTeam("team-core", true);
  store.setTeamMembersBusyForTeam("team-labs", false);
  store.appendRoomMessage("room-a", {
    id: "message-a",
    author: "Avery",
    role: "human",
    body: "Ship the store slice.",
    time: "10:17"
  });
  store.initializeMessagesForRoom("room-b");

  const state = useAppStore.getState();
  assert.equal(state.teamRosterByTeam["team-core"]?.members?.[0]?.role, "owner");
  assert.deepEqual(state.teamRosterByTeam["team-labs"]?.members, []);
  assert.equal(state.teamRosterByTeam["team-core"]?.message, null);
  assert.equal(state.teamRosterByTeam["team-labs"]?.message, "Could not refresh members");
  assert.equal(state.teamRosterByTeam["team-core"]?.busy, true);
  assert.equal(state.teamRosterByTeam["team-labs"]?.busy, false);
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.body, "Ship the store slice.");
  assert.deepEqual(state.messagesByRoom["room-b"], []);
});

test("desktop store hydrates local room history through one room-scoped action", () => {
  const store = useAppStore.getState();

  store.appendRoomMessage("room-a", {
    id: "message-live",
    author: "Maddie",
    role: "human",
    body: "Arrived while history was loading.",
    time: "10:18"
  });
  store.appendRoomMessage("room-b", {
    id: "message-b",
    author: "Jordan",
    role: "human",
    body: "Keep this room alone.",
    time: "10:16"
  });
  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setSelectedTerminalIdForRoom("room-b", "terminal-b");
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

  store.hydrateLocalRoomHistoryForRoom("room-a", {
    version: 3,
    messages: [
      {
        id: "message-a",
        author: "Avery",
        role: "human",
        body: "Restore this room.",
        time: "10:17"
      }
    ],
    chatEdits: [
      {
        id: "edit-a",
        messageId: "message-a",
        body: "Restore this edited room.",
        editedBy: "Avery",
        editedByUserId: "github:avery",
        editedAt: "2026-07-06T00:02:00.000Z"
      }
    ],
    chatDeletes: [
      {
        id: "delete-a",
        messageId: "message-old",
        deletedBy: "Avery",
        deletedByUserId: "github:avery",
        deletedAt: "2026-07-06T00:02:30.000Z"
      }
    ],
    terminalRequests: [
      {
        id: "terminal-request-a",
        requester: "Avery",
        requesterUserId: "github:avery",
        command: "npm test",
        cwd: "/Users/maddiedreese/Documents/MultAIplayer",
        requestedAt: "2026-07-06T00:03:00.000Z",
        status: "pending"
      }
    ],
    browserRequests: [
      {
        id: "browser-request-a",
        requester: "Jordan",
        requesterUserId: "github:jordan",
        url: "http://localhost:5173",
        reason: "Inspect local preview",
        requestedAt: "2026-07-06T00:04:00.000Z",
        status: "pending"
      }
    ],
    inviteRequests: [
      {
        eventType: "invite.request",
        id: "invite-request-a",
        requester: "Jordan",
        requesterUserId: "github:jordan",
        requesterDeviceId: "device-jordan",
        requestedAt: "2026-07-06T00:05:00.000Z",
        status: "pending"
      }
    ],
    codexEvents: [
      {
        eventType: "codex.turn",
        turnId: "turn-a",
        status: "event",
        message: "Reading context",
        model: "gpt-5.4",
        host: "Maddie",
        hostUserId: "github:maddie",
        createdAt: "2026-07-06T00:06:00.000Z"
      }
    ],
    gitWorkflowEvents: [
      {
        eventType: "git.workflow",
        status: "completed",
        branch: "codex/history-hydration",
        push: true,
        message: "Opened draft PR",
        runner: "Maddie",
        runnerUserId: "github:maddie",
        createdAt: "2026-07-06T00:07:00.000Z"
      }
    ],
    githubActionsEvents: [
      {
        eventType: "github.actions",
        owner: "maddiedreese",
        repo: "multAIplayer",
        branch: "main",
        summary: { label: "CI", detail: "All checks passed", tone: "green" },
        message: "Checked Actions",
        checkedBy: "Maddie",
        checkedByUserId: "github:maddie",
        checkedAt: "2026-07-06T00:08:00.000Z",
        runs: [
          {
            id: 18,
            name: "Web, relay, and packages",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/maddiedreese/multAIplayer/actions/runs/18",
            createdAt: "2026-07-06T00:07:00.000Z",
            updatedAt: "2026-07-06T00:08:00.000Z"
          }
        ]
      }
    ],
    localPreviews: [
      {
        eventType: "local.preview",
        id: "preview-a",
        sharedBy: "Maddie",
        sharedByUserId: "github:maddie",
        sourceUrl: "http://127.0.0.1:5173",
        status: "live",
        createdAt: "2026-07-06T00:09:00.000Z",
        updatedAt: "2026-07-06T00:10:00.000Z"
      }
    ],
    terminalSnapshots: [
      {
        id: "terminal-a",
        roomId: "room-a",
        name: "shell",
        cwd: "/tmp/a",
        command: "zsh -l",
        status: "running",
        output: []
      }
    ],
    hostHandoffs: [
      {
        id: "handoff-a",
        fromHost: "Maddie",
        fromUserId: "github:maddie",
        reason: "usage_limit",
        projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
        codexModel: "gpt-5.4",
        approvalPolicy: "ask",
        messagesSinceLastCodex: 4,
        attachmentNames: [],
        terminals: [],
        createdAt: "2026-07-06T00:11:00.000Z",
        status: "available"
      }
    ],
    queuedCodexTurns: [
      {
        turnId: "turn-queued-1",
        roomId: "room-a",
        requestedBy: "Jordan",
        requestedByUserId: "github:jordan",
        queuedAt: "2026-07-06T00:12:00.000Z",
        triggerMessageId: "message-a"
      }
    ],
    roomGoal: {
      id: "goal-a",
      text: "Finish encrypted history polish",
      status: "paused",
      startedAt: "2026-07-06T00:12:00.000Z",
      updatedAt: "2026-07-06T00:13:00.000Z",
      elapsedMs: 60000
    },
    codexThreadGraph: {
      activeThreadId: "thread-a",
      nodesById: {
        "thread-a": {
          id: "thread-a",
          title: "Codex thread",
          status: "unknown",
          createdAt: 0,
          updatedAt: 0
        }
      }
    }
  });

  const state = useAppStore.getState();
  assert.deepEqual(
    state.messagesByRoom["room-a"]?.map((message) => message.id),
    ["message-a", "message-live"]
  );
  assert.equal(state.chatEditsByRoom["room-a"]?.[0]?.body, "Restore this edited room.");
  assert.equal(state.chatDeletesByRoom["room-a"]?.[0]?.messageId, "message-old");
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "Keep this room alone.");
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.requests?.[0]?.command, "npm test");
  assert.equal(state.browserByRoom["room-a"]?.requests?.[0]?.url, "http://localhost:5173");
  assert.equal(state.inviteByRoom["room-a"]?.requests?.[0]?.requester, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.events?.[0]?.message, "Reading context");
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.branch,
    "codex/history-hydration"
  );
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "Opened draft PR");
  assert.equal(
    projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.runs[0]?.name,
    "Web, relay, and packages"
  );
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.runs?.[0]?.id, 18);
  assert.equal(
    projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.lastChecked,
    "2026-07-06T00:08:00.000Z"
  );
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "CI: Checked Actions");
  assert.equal(state.localPreviewByRoom["room-a"]?.previews?.[0]?.status, "live");
  assert.equal(
    state.terminals.some((terminal) => terminal.id === "terminal-a"),
    true
  );
  assert.equal(
    state.terminals.some((terminal) => terminal.id === "terminal-b"),
    true
  );
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.selectedTerminalId, "terminal-a");
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.selectedTerminalId, "terminal-b");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.reason, "usage_limit");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.[0]?.turnId, "turn-queued-1");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.goal?.text, "Finish encrypted history polish");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadGraph?.activeThreadId, "thread-a");
});

test("desktop store preserves live Codex state that arrives while an empty history payload loads", () => {
  const store = useAppStore.getState();

  store.appendCodexEvent("room-a", {
    eventType: "codex.turn",
    turnId: "turn-stale",
    status: "event",
    message: "Stale Codex event",
    model: "gpt-5.4",
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-06T00:20:00.000Z"
  });
  store.appendHostHandoff("room-a", {
    id: "handoff-stale",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "usage_limit",
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
    codexModel: "gpt-5.4",
    approvalPolicy: "ask",
    messagesSinceLastCodex: 3,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-06T00:21:00.000Z",
    status: "available"
  });
  store.setCodexThreadIdForRoom("room-a", "thread-stale");

  store.hydrateLocalRoomHistoryForRoom("room-a", {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: []
  });

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.events?.[0]?.turnId, "turn-stale");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.id, "handoff-stale");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadGraph?.activeThreadId, "thread-stale");
});

test("history hydration preserves monotonic stored state over stale live replay", () => {
  const store = useAppStore.getState();
  store.upsertCodexActivity("room-a", {
    eventType: "codex.activity",
    activityId: "activity-a",
    turnId: "turn-a",
    itemId: "item-a",
    kind: "command",
    status: "started",
    title: "Running",
    startedAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:01:00.000Z",
    host: "Maddie",
    hostUserId: "github:maddie"
  });
  store.appendBrowserRequest("room-a", {
    id: "browser-a",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    url: "https://example.com",
    reason: "Inspect",
    requestedAt: "2026-07-06T00:00:00.000Z",
    status: "pending"
  });
  store.hydrateLocalRoomHistoryForRoom("room-a", {
    version: 3,
    messages: [],
    terminalRequests: [],
    fileSaveRequests: [],
    browserRequests: [
      {
        id: "browser-a",
        requester: "Maddie",
        requesterUserId: "github:maddie",
        url: "https://example.com",
        reason: "Inspect",
        requestedAt: "2026-07-06T00:00:00.000Z",
        status: "approved"
      }
    ],
    inviteRequests: [],
    codexEvents: [],
    codexActivities: [
      {
        eventType: "codex.activity",
        activityId: "activity-a",
        turnId: "turn-a",
        itemId: "item-a",
        kind: "command",
        status: "completed",
        title: "Completed",
        startedAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:02:00.000Z",
        host: "Maddie",
        hostUserId: "github:maddie"
      }
    ],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: []
  });
  assert.equal(useAppStore.getState().codexRuntimeByRoom["room-a"]?.activities?.[0]?.status, "completed");
  assert.equal(useAppStore.getState().browserByRoom["room-a"]?.requests?.[0]?.status, "approved");
});

test("desktop store exposes team member actions", () => {
  const store = useAppStore.getState();
  const members = [
    {
      teamId: "team-core",
      userId: "github:maddie",
      role: "owner" as const,
      joinedAt: "2026-07-06T00:17:00.000Z"
    }
  ];

  store.setTeamMembersForTeam("team-core", members);
  store.setTeamMembersMessageForTeam("team-core", "Members refreshed");
  store.setTeamMembersBusyForTeam("team-core", true);
  store.ensureLocalTeamMemberForTeam("team-labs", "github:maddie", "admin");
  store.ensureLocalTeamMemberForTeam("team-labs", "github:maddie", "member");

  const state = useAppStore.getState();
  assert.equal(state.teamRosterByTeam["team-core"]?.members?.[0]?.role, "owner");
  assert.equal(state.teamRosterByTeam["team-core"]?.message, "Members refreshed");
  assert.equal(state.teamRosterByTeam["team-core"]?.busy, true);
  assert.equal(state.teamRosterByTeam["team-labs"]?.members?.length, 1);
  assert.equal(state.teamRosterByTeam["team-labs"]?.members?.[0]?.role, "admin");
});

test("desktop store exposes room chat message actions", () => {
  const store = useAppStore.getState();
  const message = {
    id: "message-a",
    author: "Avery",
    role: "human" as const,
    body: "Ship the store slice.",
    time: "10:17"
  };

  store.appendRoomMessage("room-a", message);
  store.appendRoomMessage("room-a", message);
  store.initializeMessagesForRoom("room-b");
  store.initializeMessagesForRoom("room-a");
  store.applyMessageReaction("room-a", {
    eventType: "chat.reaction",
    messageId: message.id,
    emoji: "+1",
    reactor: "Maddie",
    reactorUserId: "github:maddie",
    action: "add"
  });

  let state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.length, 1);
  assert.deepEqual(state.messagesByRoom["room-b"], []);
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.reactions?.[0]?.reactors[0]?.name, "Maddie");

  store.applyMessageReaction("room-a", {
    eventType: "chat.reaction",
    messageId: message.id,
    emoji: "+1",
    reactor: "Maddie",
    reactorUserId: "github:maddie",
    action: "remove"
  });

  state = useAppStore.getState();
  assert.deepEqual(state.messagesByRoom["room-a"]?.[0]?.reactions, []);
});

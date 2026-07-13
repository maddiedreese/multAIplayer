import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";
import { projectInvitePanelMaps } from "../src/store/slices/inviteSlice";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("desktop store keeps invite panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setInviteRequestsForRoom("room-a", [
    {
      eventType: "invite.request",
      id: "invite-request-1",
      inviteId: "invite-1",
      requester: "Jordan",
      requesterUserId: "github:jordan",
      requesterDeviceId: "device-jordan",
      requesterPublicKeyFingerprint: "1234567890abcdef",
      requestedAt: "2026-07-06T00:06:00.000Z",
      note: "Joining from laptop",
      status: "pending"
    }
  ]);
  store.setInviteSecretInputValue("multaiplayer://invite#secret");
  store.setInviteLinkForRoom("room-a", "https://multaiplayer.com/invite/room-a");
  store.setInviteApprovalGateForRoom("room-a", true);
  store.setInviteApprovalGateForRoom("room-b", false);
  store.setInviteMessageForRoom("room-a", "Invite created");
  store.setInviteMessageForRoom("room-b", null);
  store.setMembershipCommitBusyForRoom("room-a", true);
  store.setInviteAdmissionForRoom("room-a", "Admitted Jordan");
  store.setInviteAdmissionForRoom("room-b", "Admitted Avery");
  store.setInviteAdmissionForRoom("room-a", null);

  const state = useAppStore.getState();
  assert.equal(state.inviteByRoom["room-a"]?.requests?.[0]?.requester, "Jordan");
  assert.equal(state.inviteSecretInput, "multaiplayer://invite#secret");
  assert.equal(state.inviteByRoom["room-a"]?.link, "https://multaiplayer.com/invite/room-a");
  assert.equal(state.inviteByRoom["room-a"]?.approvalGate, true);
  assert.equal(state.inviteByRoom["room-b"]?.approvalGate, false);
  assert.equal(projectInvitePanelMaps(state.inviteByRoom).inviteApprovalGatesByRoom["room-b"], false);
  assert.equal(state.inviteByRoom["room-a"]?.message, "Invite created");
  assert.equal(state.inviteByRoom["room-b"]?.message, undefined);
  assert.equal(state.inviteByRoom["room-a"]?.membershipCommitBusy, true);
  assert.equal(state.inviteByRoom["room-a"]?.admission, undefined);
  assert.equal(state.inviteByRoom["room-b"]?.admission, "Admitted Avery");
});

test("desktop store exposes room invite actions", () => {
  const store = useAppStore.getState();

  store.setInviteLinkForRoom("room-a", "https://multaiplayer.com/invite/room-a");
  store.setInviteApprovalGateForRoom("room-a", true);
  store.setInviteMessageForRoom("room-a", "Invite created");
  store.setInviteLinkForRoom("room-b", "");
  store.setInviteApprovalGateForRoom("room-b", false);
  store.setInviteMessageForRoom("room-a", null);

  const state = useAppStore.getState();
  assert.equal(state.inviteByRoom["room-a"]?.link, "https://multaiplayer.com/invite/room-a");
  assert.equal(state.inviteByRoom["room-a"]?.approvalGate, true);
  assert.equal(state.inviteByRoom["room-a"]?.message, undefined);
  assert.equal(state.inviteByRoom["room-b"]?.link, undefined);
  assert.equal(state.inviteByRoom["room-b"]?.approvalGate, false);
});

test("desktop store keeps room chat composition state room scoped", () => {
  const store = useAppStore.getState();

  store.setChatMessageForRoom("room-a", "Sending message");
  store.setChatMessageForRoom("room-b", null);
  store.setDraftForRoom("room-a", "@Codex draft a test plan");
  store.setDraftForRoom("room-b", "Looks good");
  store.setPendingAttachmentsForRoom("room-a", [
    {
      id: "attachment-1",
      name: "README.md",
      type: "text/markdown",
      size: 18,
      content: "# multAIplayer"
    }
  ]);
  store.setSensitiveAttachmentReviewKey("room-a:.env");

  const state = useAppStore.getState();
  assert.equal(state.roomChatByRoom["room-a"]?.message, "Sending message");
  assert.equal(state.roomChatByRoom["room-b"]?.message, undefined);
  assert.equal(state.roomChatByRoom["room-a"]?.draft, "@Codex draft a test plan");
  assert.equal(state.roomChatByRoom["room-b"]?.draft, "Looks good");
  assert.equal(state.roomChatByRoom["room-a"]?.pendingAttachments?.[0]?.name, "README.md");
  assert.equal(state.sensitiveAttachmentReviewKey, "room-a:.env");
});

test("desktop store exposes room draft actions", () => {
  const store = useAppStore.getState();

  store.setDraftForRoom("room-a", "@Codex summarize this");
  const readmeAttachment = {
    id: "attachment-1",
    name: "README.md",
    type: "text/markdown",
    size: 18,
    content: "# multAIplayer"
  };
  const planAttachment = {
    id: "attachment-2",
    name: "plan.md",
    type: "text/markdown",
    size: 12,
    content: "Ship it"
  };

  store.setPendingAttachmentsForRoom("room-a", [readmeAttachment]);
  store.appendPendingAttachmentForRoom("room-a", planAttachment);
  store.appendPendingAttachmentForRoom("room-a", planAttachment);

  let state = useAppStore.getState();
  assert.equal(state.roomChatByRoom["room-a"]?.draft, "@Codex summarize this");
  assert.deepEqual(
    state.roomChatByRoom["room-a"]?.pendingAttachments?.map((attachment) => attachment.name),
    ["README.md", "plan.md"]
  );

  store.removePendingAttachmentForRoom("room-a", "attachment-1");
  state = useAppStore.getState();
  assert.deepEqual(
    state.roomChatByRoom["room-a"]?.pendingAttachments?.map((attachment) => attachment.name),
    ["plan.md"]
  );

  store.clearPendingAttachmentsForRoom("room-a");
  state = useAppStore.getState();
  assert.equal(state.roomChatByRoom["room-a"]?.pendingAttachments, undefined);
});

test("desktop store exposes room message actions", () => {
  const store = useAppStore.getState();

  store.setHostMessageForRoom("room-a", "Host saved");
  store.setChatMessageForRoom("room-a", "Message sent");
  store.setMarkdownCopyFallbackForRoom("room-a", {
    title: "Selected messages",
    markdown: "## Room"
  });
  store.setSecretWarningVisibleForRoom("room-a", true);
  store.setHistoryMessageForRoom("room-a", "History saved");
  store.setTeamHistoryMessageForTeam("team-a", "Team defaults saved");
  store.setSettingsMessageForRoom("room-a", "Settings saved");

  let state = useAppStore.getState();
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Host saved");
  assert.equal(state.roomChatByRoom["room-a"]?.message, "Message sent");
  assert.equal(state.filePanelByRoom["room-a"]?.markdownCopyFallback?.title, "Selected messages");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.secretWarningVisible, true);
  assert.equal(state.historyPresenceByRoom["room-a"]?.historyMessage, "History saved");
  assert.equal(state.teamHistoryByTeam["team-a"]?.message, "Team defaults saved");
  assert.equal(state.roomSettingsByRoom["room-a"]?.settingsMessage, "Settings saved");

  store.setHostMessageForRoom("room-a", null);
  store.setChatMessageForRoom("room-a", null);
  store.setMarkdownCopyFallbackForRoom("room-a", null);
  store.setSecretWarningVisibleForRoom("room-a", false);
  store.setHistoryMessageForRoom("room-a", null);
  store.setTeamHistoryMessageForTeam("team-a", null);
  store.setSettingsMessageForRoom("room-a", null);

  state = useAppStore.getState();
  assert.equal("room-a" in state.roomSettingsByRoom, false);
  assert.equal("room-a" in state.roomChatByRoom, false);
  assert.equal("room-a" in state.filePanelByRoom, false);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.secretWarningVisible, undefined);
  assert.equal("room-a" in state.historyPresenceByRoom, false);
  assert.equal("team-a" in state.teamHistoryByTeam, false);
});

test("desktop store keeps Codex room state room scoped", () => {
  const store = useAppStore.getState();

  store.appendCodexEvent("room-a", {
    eventType: "codex.turn",
    turnId: "turn-1",
    status: "started",
    message: "Reading room context",
    model: "gpt-5.4",
    threadId: "thread-room-a",
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-06T00:07:00.000Z"
  });
  store.setApprovalVisibleForRoom("room-a", true);
  store.setApprovalVisibleForRoom("room-b", false);
  store.setPendingCodexApprovalForRoom("room-a", {
    turnId: "turn-pending-a",
    roomId: "room-a",
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queuedAt: "2026-07-06T00:07:00.000Z",
    messages: [
      {
        id: "message-1",
        author: "Avery",
        role: "human",
        body: "@Codex draft a plan",
        time: "9:43"
      }
    ],
    summary: {
      messagesSinceLastCodex: 1,
      attachments: [],
      workspacePath: "/Users/maddiedreese/Documents/MultAIplayer",
      git: null,
      browserAccess: [],
      terminals: []
    }
  });
  store.setCodexRunningForRoom("room-a", true);
  store.setCodexRunningForRoom("room-b", false);
  store.setRoomGoalForRoom("room-a", {
    id: "goal-a",
    text: "Finish the room",
    status: "running",
    startedAt: "2026-07-06T00:08:00.000Z",
    updatedAt: "2026-07-06T00:08:00.000Z",
    elapsedMs: 0
  });
  store.setSecretWarningVisibleForRoom("room-a", true);
  store.setCodexThreadIdForRoom("room-a", "thread-room-a");

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.events?.[0]?.turnId, "turn-1");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, true);
  assert.equal(state.codexRuntimeByRoom["room-b"]?.approvalVisible, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval?.messages[0]?.body, "@Codex draft a plan");
  assert.equal(
    state.codexRuntimeByRoom["room-a"]?.pendingApproval?.summary.workspacePath,
    "/Users/maddiedreese/Documents/MultAIplayer"
  );
  assert.equal(state.codexRuntimeByRoom["room-a"]?.running, true);
  assert.equal(state.codexRuntimeByRoom["room-b"]?.running, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.goal?.text, "Finish the room");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.secretWarningVisible, true);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadId, "thread-room-a");
});

test("desktop store exposes room Codex approval actions", () => {
  const store = useAppStore.getState();
  const approval = {
    turnId: "turn-pending-a",
    roomId: "room-a",
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queuedAt: "2026-07-06T00:07:00.000Z",
    messages: [
      {
        id: "message-1",
        author: "Avery",
        role: "human" as const,
        body: "@Codex draft a plan",
        time: "9:43"
      }
    ],
    summary: {
      messagesSinceLastCodex: 1,
      attachments: [],
      workspacePath: "/Users/maddiedreese/Documents/MultAIplayer",
      git: null,
      browserAccess: [],
      terminals: []
    }
  };
  const queuedApproval = {
    ...approval,
    turnId: "turn-queued-a",
    queuedAt: "2026-07-06T00:08:00.000Z"
  };

  store.setApprovalVisibleForRoom("room-a", true);
  store.setPendingCodexApprovalForRoom("room-a", approval);
  store.enqueueCodexApprovalForRoom("room-a", queuedApproval);
  store.setCodexRunningForRoom("room-a", true);
  store.setRoomGoalForRoom("room-a", {
    id: "goal-a",
    text: "Refactor the UI",
    status: "running",
    startedAt: "2026-07-06T00:08:00.000Z",
    updatedAt: "2026-07-06T00:08:00.000Z",
    elapsedMs: 0
  });
  store.setApprovalVisibleForRoom("room-b", true);
  store.resetCodexApprovalForRoom("room-a");
  store.setCodexRunningForRoom("room-a", false);
  store.setRoomGoalForRoom("room-a", null);

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.running, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.goal, undefined);
  assert.equal(state.codexRuntimeByRoom["room-b"]?.approvalVisible, true);
});

test("desktop store edits and deletes messages while refreshing pending Codex approvals", () => {
  const store = useAppStore.getState();
  store.appendRoomMessage("room-a", {
    id: "message-1",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "@Codex draft a plan",
    time: "9:43"
  });
  store.appendRoomMessage("room-a", {
    id: "message-2",
    author: "Jordan",
    authorUserId: "github:jordan",
    role: "human",
    body: "remote message",
    time: "9:44"
  });
  store.setPendingCodexApprovalForRoom("room-a", {
    turnId: "turn-pending-a",
    roomId: "room-a",
    requestedBy: "Maddie",
    requestedByUserId: "github:maddie",
    queuedAt: "2026-07-08T12:00:00.000Z",
    messages: [
      {
        id: "message-1",
        author: "Maddie",
        authorUserId: "github:maddie",
        role: "human",
        body: "@Codex draft a plan",
        time: "9:43"
      },
      {
        id: "message-2",
        author: "Jordan",
        authorUserId: "github:jordan",
        role: "human",
        body: "remote message",
        time: "9:44"
      }
    ],
    summary: {
      messagesSinceLastCodex: 2,
      attachments: [],
      workspacePath: null,
      git: null,
      browserAccess: [],
      terminals: []
    }
  });
  store.setApprovalVisibleForRoom("room-a", true);

  store.editRoomMessage("room-a", {
    id: "edit-1",
    messageId: "message-1",
    body: "@Codex draft a safer plan",
    editedBy: "Maddie",
    editedByUserId: "github:maddie",
    editedAt: "2026-07-08T12:01:00.000Z"
  });

  let state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.body, "@Codex draft a safer plan");
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.editedAt, "2026-07-08T12:01:00.000Z");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval?.messages[0]?.body, "@Codex draft a safer plan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval?.summary.messagesSinceLastCodex, 2);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, true);
  assert.deepEqual(state.chatEditsByRoom["room-a"], [
    {
      id: "edit-1",
      messageId: "message-1",
      body: "@Codex draft a safer plan",
      editedBy: "Maddie",
      editedByUserId: "github:maddie",
      editedAt: "2026-07-08T12:01:00.000Z"
    }
  ]);

  store.deleteRoomMessage("room-a", {
    id: "delete-1",
    messageId: "message-2",
    deletedBy: "Maddie",
    deletedByUserId: "github:maddie",
    deletedAt: "2026-07-08T12:02:00.000Z"
  });
  state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.[1]?.deletedAt, undefined);

  store.deleteRoomMessage("room-a", {
    id: "delete-2",
    messageId: "message-2",
    deletedBy: "Jordan",
    deletedByUserId: "github:jordan",
    deletedAt: "2026-07-08T12:03:00.000Z"
  });
  state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.[1]?.body, "");
  assert.equal(state.messagesByRoom["room-a"]?.[1]?.deletedAt, "2026-07-08T12:03:00.000Z");
  assert.equal(state.messagesByRoom["room-a"]?.[1]?.deletedBy, "Jordan");
  assert.deepEqual(state.chatDeletesByRoom["room-a"], [
    {
      id: "delete-2",
      messageId: "message-2",
      deletedBy: "Jordan",
      deletedByUserId: "github:jordan",
      deletedAt: "2026-07-08T12:03:00.000Z"
    }
  ]);
  assert.deepEqual(
    state.codexRuntimeByRoom["room-a"]?.pendingApproval?.messages.map((message) => message.id),
    ["message-1"]
  );
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval?.summary.messagesSinceLastCodex, 1);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, true);
});

test("desktop store keeps queued Codex turn intents in order", () => {
  const store = useAppStore.getState();
  const queuedTurn = {
    turnId: "turn-queued-1",
    roomId: "room-a",
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queuedAt: "2026-07-06T00:07:00.000Z"
  };
  const secondQueuedTurn = {
    ...queuedTurn,
    turnId: "turn-queued-2",
    requestedBy: "Jordan",
    requestedByUserId: "github:jordan",
    queuedAt: "2026-07-06T00:08:00.000Z"
  };

  store.enqueueCodexApprovalForRoom("room-a", queuedTurn);
  store.enqueueCodexApprovalForRoom("room-a", secondQueuedTurn);
  store.enqueueCodexApprovalForRoom("room-a", secondQueuedTurn);

  let state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.length, 2);
  assert.deepEqual(
    state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.map((turn) => turn.turnId),
    ["turn-queued-1", "turn-queued-2"]
  );

  store.removeQueuedCodexApprovalForRoom("room-a", "turn-queued-2");

  state = useAppStore.getState();
  assert.deepEqual(
    state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.map((turn) => turn.turnId),
    ["turn-queued-1"]
  );
});

test("desktop store rejects edit and delete mutations after a Codex started event consumes the message", () => {
  const store = useAppStore.getState();
  store.appendRoomMessage("room-a", {
    id: "message-consumed",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "@Codex use this",
    time: "9:43",
    createdAt: "2026-07-08T12:00:00.000Z"
  });
  store.appendCodexEvent("room-a", {
    eventType: "codex.turn",
    turnId: "turn-consumed",
    status: "started",
    message: "Started Codex turn.",
    model: "gpt-5.5",
    consumedMessageIds: ["message-consumed"],
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-08T12:01:00.000Z"
  });

  store.editRoomMessage("room-a", {
    id: "edit-consumed",
    messageId: "message-consumed",
    body: "late edit",
    editedBy: "Maddie",
    editedByUserId: "github:maddie",
    editedAt: "2026-07-08T12:02:00.000Z"
  });
  store.deleteRoomMessage("room-a", {
    id: "delete-consumed",
    messageId: "message-consumed",
    deletedBy: "Maddie",
    deletedByUserId: "github:maddie",
    deletedAt: "2026-07-08T12:03:00.000Z"
  });

  const message = useAppStore.getState().messagesByRoom["room-a"]?.find((item) => item.id === "message-consumed");
  assert.equal(message?.body, "@Codex use this");
  assert.equal(message?.editedAt, undefined);
  assert.equal(message?.deletedAt, undefined);
  assert.equal(useAppStore.getState().chatEditsByRoom["room-a"], undefined);
  assert.equal(useAppStore.getState().chatDeletesByRoom["room-a"], undefined);
});

test("desktop store exposes room Codex thread actions", () => {
  const store = useAppStore.getState();

  store.setCodexThreadIdForRoom("room-a", "thread-room-a");
  assert.equal(useAppStore.getState().codexRuntimeByRoom["room-a"]?.threadId, "thread-room-a");

  store.setCodexThreadIdForRoom("room-a", null);
  assert.equal(useAppStore.getState().codexRuntimeByRoom["room-a"]?.threadId, undefined);
});

test("desktop store keeps markdown message selection room scoped", () => {
  const store = useAppStore.getState();

  store.toggleSelectedMessageForRoom("room-a", "message-1");
  store.toggleSelectedMessageForRoom("room-a", "message-2");
  store.toggleSelectedMessageForRoom("room-b", "message-9");
  store.toggleSelectedMessageForRoom("room-a", "message-1");

  const state = useAppStore.getState();
  assert.deepEqual(state.roomChatByRoom["room-a"]?.selectedMessageIds, ["message-2"]);
  assert.deepEqual(state.roomChatByRoom["room-b"]?.selectedMessageIds, ["message-9"]);

  store.clearSelectedMessagesForRoom("room-a");
  assert.equal(useAppStore.getState().roomChatByRoom["room-a"]?.selectedMessageIds, undefined);
});

test("desktop store keeps history search messages room scoped", () => {
  const store = useAppStore.getState();

  store.setHistorySearchResultsByRoom({
    "room-a": [
      {
        id: "history-message-1",
        author: "Jordan",
        role: "human",
        body: "Find the old setup note",
        time: "Yesterday"
      }
    ],
    "room-b": [
      {
        id: "history-message-2",
        author: "Codex",
        role: "codex",
        body: "Previous plan summary",
        time: "Jul 6"
      }
    ]
  });

  const state = useAppStore.getState();
  assert.equal(state.historyPresenceByRoom["room-a"]?.searchMessages?.[0]?.body, "Find the old setup note");
  assert.equal(state.historyPresenceByRoom["room-b"]?.searchMessages?.[0]?.author, "Codex");

  store.clearHistorySearchResults();
  assert.deepEqual(useAppStore.getState().historyPresenceByRoom, {});
});

test("desktop store keeps history status messages scoped", () => {
  const store = useAppStore.getState();

  store.setHistoryMessageForRoom("room-a", "Local history saved");
  store.setHistoryMessageForRoom("room-b", null);
  store.setTeamHistoryMessageForTeam("team-core", "Team defaults saved");
  store.setTeamHistoryMessageForTeam("__no-team", null);

  const state = useAppStore.getState();
  assert.equal(state.historyPresenceByRoom["room-a"]?.historyMessage, "Local history saved");
  assert.equal(state.historyPresenceByRoom["room-b"]?.historyMessage, undefined);
  assert.equal(state.teamHistoryByTeam["team-core"]?.message, "Team defaults saved");
  assert.equal(state.teamHistoryByTeam["__no-team"]?.message, undefined);
});

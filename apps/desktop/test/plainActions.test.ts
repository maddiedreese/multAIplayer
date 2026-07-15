import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { createAccountActions } from "../src/lib/accountActions";
import { createChatActions } from "../src/lib/chatActions";
import { createCodexInvokeActions } from "../src/lib/codexInvokeActions";
import { createFileActions } from "../src/lib/fileActions";
import { createGitWorkflowActions } from "../src/lib/gitWorkflowActions";
import { buildGitWorkflowApprovalPreview, defaultGitWorkflowDraft } from "../src/lib/gitWorkflowDraft";
import { checkGitHubWorkflowReadiness } from "../src/lib/githubWorkflowReadiness";
import { createMarkdownCopyActions } from "../src/lib/markdownCopyActions";
import { createMemberActions } from "../src/lib/memberActions";
import { createLocalPreviewActions } from "../src/lib/localPreviewActions";
import { createLocalHistoryActions } from "../src/lib/localHistoryActions";
import { createRoomVisibilityWarningActions } from "../src/lib/roomVisibilityWarningActions";
import { createRoomSettingsActions } from "../src/lib/roomSettingsActions";
import { createTeamDefaultActions } from "../src/lib/teamDefaultActions";
import { createWorkspaceCreationActions } from "../src/lib/workspaceCreationActions";
import { useAppStore } from "../src/store/appStore";
import type { ChatMessage } from "../src/types";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string) => {
      if (command === "mls_history_delete_all" || command === "mls_history_retention_set") return null;
      throw new Error(`Unexpected native command: ${command}`);
    }
  }
});

const room: ClientRoomRecord = {
  id: "room-actions",
  teamId: "team-actions",
  name: "Actions",
  projectPath: "/tmp/actions",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

test.beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "multaiplayer:app-config",
    JSON.stringify({ relayHttpUrl: "https://relay.test", relayWsUrl: "wss://relay.test/rooms" })
  );
  useAppStore.getState().resetAppStore();
  useAppStore.setState({
    teams: [{ id: room.teamId, name: "Actions team", members: 1 }],
    rooms: [room],
    selectedTeam: room.teamId,
    selectedRoomId: room.id,
    currentUser: { id: "github:maddie", login: "maddie", name: "Maddie" }
  });
});

test("account sign-out actions preserve preview cleanup ordering without React", async () => {
  const calls: string[] = [];
  const actions = createAccountActions({
    selectedRoomId: room.id,
    deviceId: "device-1",
    stopOwnedLocalPreviews: async (reason) => {
      calls.push(`preview:${reason}`);
    },
    signOutGitHub: async () => {
      calls.push("github");
    },
    replaceDeviceIdentity: () => undefined,
    setDeviceIdentityStatusMessage: () => undefined,
    untrustDeviceForRoom: () => undefined
  });

  await actions.signOut();

  assert.deepEqual(calls, ["preview:Stopped because the sharing user signed out.", "github"]);
});

test("visibility warning actions update persistence and the current Zustand store", () => {
  useAppStore.getState().setSecretWarningVisibleForRoom(room.id, true);
  const actions = createRoomVisibilityWarningActions();

  actions.acknowledgeRoomVisibilityWarning();

  assert.equal(localStorage.getItem(`multaiplayer:room-visibility-warning:${room.id}`), "acknowledged");
  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.secretWarningVisible ?? false, false);
});

test("local history actions resolve Zustand mutations when invoked without React", async () => {
  const replacedSettings: Array<{ enabled: boolean; retentionDays: number }> = [];
  const actions = createLocalHistoryActions({
    hasSelectedRoom: true,
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    isSelectedRoomLocked: false,
    isSelectedRoomRevoked: false,
    isActiveHost: true,
    messages: [],
    terminalRequests: [],
    fileSaveRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    codexActivities: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminals: [],
    hostHandoffs: [],
    roomGoal: null,
    selectedCodexThreadId: null,
    codexThreadGraph: { activeThreadId: null, nodesById: {} },
    settingsBusyRef: { current: {} },
    reportRoomSettingsMutationInFlight: () => false,
    roomSettingsActor: () => ({ requesterName: "Maddie", requesterUserId: "github:maddie" }),
    replaceHistorySettings: (settings) => replacedSettings.push(settings),
    replaceRoom: () => undefined,
    historyLoadedRoomIds: { current: new Set() }
  });
  const messages: Array<[string, string | null]> = [];
  useAppStore.setState({
    setHistoryMessageForRoom: (roomId, message) => messages.push([roomId, message])
  });

  await actions.updateLocalHistorySettings({ enabled: false, retentionDays: 14 });

  assert.deepEqual(replacedSettings, [{ enabled: false, retentionDays: 14 }]);
  assert.deepEqual(messages, [[room.id, "Encrypted local history is disabled for this room."]]);
});

test("member actions update the current Zustand roster without React", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        members: [
          {
            teamId: room.teamId,
            userId: "github:alex",
            role: "admin",
            joinedAt: "2026-07-09T12:00:00.000Z"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  try {
    const actions = createMemberActions({
      selectedTeam: room.teamId,
      selectedTeamName: "Actions Team",
      selectedRoom: room,
      localUser: { id: "github:maddie", name: "Maddie" },
      currentUser: null,
      setDeviceIdentityMessage: () => undefined,
      trustDeviceForRoom: () => undefined,
      untrustDeviceForRoom: () => undefined,
      updateTeamRoleForTeam: () => undefined,
      updateTeamMemberCountForTeam: () => undefined,
      rotateRoomKeyForDevices: async () => undefined,
      copyMarkdownWithFallback: async () => undefined
    });

    await actions.changeTeamMemberRole(
      {
        teamId: room.teamId,
        userId: "github:alex",
        role: "member",
        joinedAt: "2026-07-09T12:00:00.000Z"
      },
      "admin"
    );

    const roster = useAppStore.getState().teamRosterByTeam[room.teamId];
    assert.equal(roster?.members?.[0]?.role, "admin");
    assert.equal(roster?.busy, false);
    assert.match(roster?.message ?? "", /alex is now Admin/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("member removal aborts before relay revocation unless every active room is locally hosted", async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ members: [] }), { status: 200 });
  };
  useAppStore.setState({ rooms: [{ ...room, hostUserId: "github:other" }] });
  try {
    const actions = createMemberActions({
      setDeviceIdentityMessage: () => undefined,
      trustDeviceForRoom: () => undefined,
      untrustDeviceForRoom: () => undefined,
      updateTeamRoleForTeam: () => undefined,
      updateTeamMemberCountForTeam: () => undefined,
      rotateRoomKeyForDevices: async () => undefined,
      copyMarkdownWithFallback: async () => undefined
    });
    await actions.removeMemberFromTeam({
      teamId: room.teamId,
      userId: "github:alex",
      role: "member",
      joinedAt: "2026-07-09T12:00:00.000Z"
    });
    assert.equal(fetchCount, 0);
    assert.match(useAppStore.getState().teamRosterByTeam[room.teamId]?.message ?? "", /Removal was not started/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("member removal reports relay-revoked but incomplete cryptographic transitions explicitly", async () => {
  const originalFetch = globalThis.fetch;
  let removalCalls = 0;
  globalThis.fetch = async () => {
    removalCalls += 1;
    return removalCalls === 1
      ? new Response(JSON.stringify({ members: [] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "Team member not found", code: "team_member_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
  };
  try {
    const target = {
      teamId: room.teamId,
      userId: "github:alex",
      role: "member" as const,
      joinedAt: "2026-07-09T12:00:00.000Z"
    };
    useAppStore.getState().setTeamMembersForTeam(room.teamId, [target]);
    let commitAttempts = 0;
    const actions = createMemberActions({
      setDeviceIdentityMessage: () => undefined,
      trustDeviceForRoom: () => undefined,
      untrustDeviceForRoom: () => undefined,
      updateTeamRoleForTeam: () => undefined,
      updateTeamMemberCountForTeam: () => undefined,
      removeMembersFromMlsGroup: async () => {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error("commit failed");
      },
      copyMarkdownWithFallback: async () => undefined
    });
    await actions.removeMemberFromTeam(target);
    const message = useAppStore.getState().teamRosterByTeam[room.teamId]?.message ?? "";
    assert.match(message, /relay access was removed/);
    assert.match(message, /MLS Remove commits are incomplete/);
    assert.match(message, /Actions: Error: commit failed/);
    assert.doesNotMatch(message, /^Removed /);
    assert.equal(useAppStore.getState().teamRosterByTeam[room.teamId]?.members?.[0]?.userId, target.userId);

    await actions.removeMemberFromTeam(target);
    assert.equal(removalCalls, 2);
    assert.equal(commitAttempts, 2);
    assert.deepEqual(useAppStore.getState().teamRosterByTeam[room.teamId]?.members, []);
    assert.match(useAppStore.getState().teamRosterByTeam[room.teamId]?.message ?? "", /^Removed /);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace creation actions restore the new room through the current store", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ room }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  const store = useAppStore.getState();
  store.revokeWorkspaceAccess(room.teamId, room.id);
  useAppStore.setState({
    newRoomName: room.name,
    newRoomProjectPath: room.projectPath
  });
  const upsertedRooms: ClientRoomRecord[] = [];
  try {
    const actions = createWorkspaceCreationActions({
      setWorkspaceStatusError: () => undefined,
      setSelectedTeam: () => undefined,
      setSelectedRoomId: () => undefined,
      setNewTeamName: () => undefined,
      setNewRoomName: () => undefined,
      setNewRoomProjectPath: () => undefined,
      upsertTeam: () => undefined,
      upsertRoom: (nextRoom) => upsertedRooms.push(nextRoom),
      roomSettingsActor: () => ({ requesterName: "Maddie", requesterUserId: "github:maddie" })
    });

    await actions.addRoom();

    const current = useAppStore.getState();
    assert.equal(upsertedRooms[0]?.id, room.id);
    assert.equal(current.revokedRoomIds.has(room.id), false);
    assert.equal(current.revokedTeamIds.has(room.teamId), false);
    assert.equal(current.forgottenRoomIds.has(room.id), false);
    assert.deepEqual(current.messagesByRoom[room.id], []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat actions append through the latest store when the relay is offline", async () => {
  const message: ChatMessage = {
    id: "message-1",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "Hello",
    time: "9:43",
    createdAt: "2026-07-09T12:00:00.000Z"
  };
  const actions = createChatActions({
    hasSelectedRoom: true,
    selectedRoomId: room.id,
    selectedRoom: room,
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-1",
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set() }
  });

  await actions.publishChatMessage(message);

  assert.deepEqual(useAppStore.getState().messagesByRoom[room.id], [message]);
});

test("chat actions observe relay and access changes made after creation", async () => {
  const message: ChatMessage = {
    id: "message-latest-state",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "Hello",
    time: "9:43",
    createdAt: "2026-07-09T12:00:00.000Z"
  };
  const published: unknown[] = [];
  useAppStore.getState().replaceRelayStatus("open");
  const actions = createChatActions({
    hasSelectedRoom: true,
    selectedRoomId: room.id,
    selectedRoom: room,
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-1",
    relayRef: { current: { publish: (payload: unknown) => published.push(payload) } as never },
    seenEnvelopeIds: { current: new Set() }
  });

  useAppStore.getState().replaceRelayStatus("closed");
  await actions.publishChatMessage(message);
  assert.deepEqual(published, []);
  assert.deepEqual(useAppStore.getState().messagesByRoom[room.id], [message]);

  useAppStore.getState().revokeRoomAccess(room.id);
  await actions.publishChatMessage({ ...message, id: "message-revoked" });
  assert.equal(useAppStore.getState().messagesByRoom[room.id]?.length, 1);
  assert.match(useAppStore.getState().roomChatByRoom[room.id]?.message ?? "", /removed|revoked|locked/i);
});

test("chat edits observe Codex watermark changes made after creation", async () => {
  const message: ChatMessage = {
    id: "message-before-codex",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "Original",
    time: "9:43",
    createdAt: "2026-07-09T12:00:00.000Z"
  };
  const actions = createChatActions({
    hasSelectedRoom: true,
    selectedRoomId: room.id,
    selectedRoom: room,
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-1",
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set() }
  });

  useAppStore.getState().appendCodexEvent(room.id, {
    eventType: "codex.turn",
    turnId: "turn-after-creation",
    status: "started",
    message: "Started Codex turn.",
    model: "gpt-5.4",
    consumedMessageIds: [message.id],
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-09T12:01:00.000Z"
  });
  await actions.publishChatMessageEdit(message, "Changed");

  assert.deepEqual(useAppStore.getState().chatEditsByRoom[room.id] ?? [], []);
  assert.match(useAppStore.getState().roomChatByRoom[room.id]?.message ?? "", /already sent to Codex/i);
});

test("chat actions resolve the selected room when invoked, not when created", async () => {
  const nextRoom = { ...room, id: "room-actions-next", name: "Next Actions" };
  const actions = createChatActions({
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-1",
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set() }
  });
  useAppStore.setState({ rooms: [room, nextRoom], selectedRoomId: nextRoom.id });
  const message: ChatMessage = {
    id: "message-after-selection-change",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "New room",
    time: "9:43",
    createdAt: "2026-07-09T12:00:00.000Z"
  };

  await actions.publishChatMessage(message);

  assert.deepEqual(useAppStore.getState().messagesByRoom[nextRoom.id], [message]);
  assert.equal(useAppStore.getState().messagesByRoom[room.id], undefined);
});

test("Codex invoke actions report room locks through Zustand without React", () => {
  const actions = createCodexInvokeActions({
    hasSelectedRoom: true,
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    isActiveHost: true,
    canReadLocalWorkspace: true,
    hostGateMessage: "Only the active host can approve this turn.",
    localUser: { id: "github:maddie", name: "Maddie" },
    publishChatMessage: async () => undefined,
    handleCodexBrowserOpenCommand: () => false,
    publishCodexQueueEvent: async () => undefined,
    publishCodexEvent: async () => undefined
  });

  useAppStore.getState().rememberForgottenRoom(room.id);
  actions.handleCodexInvoke();

  assert.match(useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "", /forgotten|locked/i);
  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.approvalVisible ?? false, false);
});

test("local preview actions report a room lock through the current store without React", async () => {
  const actions = createLocalPreviewActions({
    hasSelectedRoom: true,
    selectedRoom: room,
    rooms: [room],
    localUser: { id: "github:maddie", name: "Maddie" },
    publishLocalPreviewEvent: async () => undefined
  });

  useAppStore.getState().rememberForgottenRoom(room.id);
  await actions.openLocalPreviewDialog();

  assert.match(useAppStore.getState().roomChatByRoom[room.id]?.message ?? "", /forgotten on this device/i);
  assert.equal(useAppStore.getState().localPreviewDialog.open, false);
});

test("local preview confirmation validation writes through the current store", async () => {
  const actions = createLocalPreviewActions({
    hasSelectedRoom: true,
    selectedRoom: room,
    rooms: [room],
    localUser: { id: "github:maddie", name: "Maddie" },
    publishLocalPreviewEvent: async () => undefined
  });

  useAppStore.setState({
    localPreviewDialog: {
      ...useAppStore.getState().localPreviewDialog,
      roomId: room.id,
      selectedUrl: "not a local URL"
    }
  });
  await actions.prepareLocalPreviewConfirmation();

  assert.match(useAppStore.getState().localPreviewDialog.error ?? "", /valid.*URL/i);
});

test("room settings actions report room locks through the current store without React", async () => {
  const settingsBusyRef = { current: {} as Record<string, boolean> };
  const actions = createRoomSettingsActions({
    hasSelectedRoom: true,
    isActiveHost: true,
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    settingsBusyRef,
    selectedCodexModel: room.codexModel,
    selectedCodexReasoningEffort: "high",
    selectedCodexSpeed: "standard",
    selectedCodexSandboxLevel: "workspace-write",
    approvalPolicyLabels: { auto: "Auto", ask_every_turn: "Ask every turn" },
    roomSettingsGateMessage: "Only the active host can change room settings.",
    roomSettingsActor: () => ({ requesterName: "Maddie", requesterUserId: "github:maddie" }),
    reportRoomSettingsMutationInFlight: () => false,
    replaceRoom: () => undefined,
    publishRoomSettingsEvent: async () => undefined
  });

  useAppStore.getState().rememberForgottenRoom(room.id);
  await actions.setApprovalPolicy("auto");

  assert.match(useAppStore.getState().roomSettingsByRoom[room.id]?.settingsMessage ?? "", /forgotten|locked/i);
  assert.deepEqual(settingsBusyRef.current, {});
});

test("room settings actions publish the host-controlled raw reasoning sharing decision", async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ setting: string; previousValue: string; nextValue: string }> = [];
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ room: { ...room, codexRawReasoningEnabled: true } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const actions = createRoomSettingsActions({
      selectedRoomIdRef: { current: room.id },
      settingsBusyRef: { current: {} },
      approvalPolicyLabels: { ask_every_turn: "Ask every turn" },
      reportRoomSettingsMutationInFlight: () => false,
      replaceRoom: () => undefined,
      publishRoomSettingsEvent: async (_updatedRoom, event) =>
        events.push({
          setting: event.setting,
          previousValue: event.previousValue,
          nextValue: event.nextValue
        })
    });

    await actions.setCodexRawReasoningEnabled(true);

    assert.equal(requestBody?.codexRawReasoningEnabled, undefined);
    assert.equal(requestBody?.requesterUserId, "github:maddie");
    assert.deepEqual(events, [{ setting: "codexRawReasoningEnabled", previousValue: "false", nextValue: "true" }]);
    assert.match(
      useAppStore.getState().roomSettingsByRoom[room.id]?.settingsMessage ?? "",
      /shared with and retained by room members/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("team default actions report missing selection without touching storage", () => {
  const storageSizeBefore = localStorage.length;
  const messages: Array<string | null> = [];
  const actions = createTeamDefaultActions({
    approvalPolicyLabels: {},
    setSelectedTeamHistoryMessage: (message) => messages.push(message),
    setTeamHistoryMessageForTeam: () => undefined,
    setTeamHistorySettings: () => undefined,
    setTeamDefaultApprovalPolicy: () => undefined,
    setTeamDefaultCodexModel: () => undefined,
    setTeamDefaultBrowserProfilePersistent: () => undefined,
    setTeamDefaultInviteApprovalGate: () => undefined
  });

  useAppStore.getState().setSelectedTeam("");
  actions.updateTeamDefaultCodexModel("gpt-5.4");

  assert.deepEqual(messages, ["Create or select a team before changing team defaults."]);
  assert.equal(localStorage.length, storageSizeBefore);
});

test("Markdown copy actions report validation failures through Zustand without React", async () => {
  const actions = createMarkdownCopyActions({
    hasSelectedRoom: true,
    canReadLocalWorkspace: true,
    localWorkspaceMessage: "Workspace unavailable.",
    selectedRoom: room,
    teams: [],
    messages: [],
    selectedMessages: [],
    gitStatus: null,
    selectedFile: null,
    selectedDiff: null,
    selectedFileRisks: [],
    selectedTerminal: null,
    terminalLines: [],
    terminalRisks: []
  });

  await actions.copySelectedMessagesMarkdown();

  assert.equal(useAppStore.getState().roomChatByRoom[room.id]?.message, "Select one or more messages to copy.");
});

test("file actions resolve current Zustand file state when invoked without React", async () => {
  const selectedRoomIdRef = { current: room.id };
  const actions = createFileActions({
    hasSelectedRoom: true,
    canReadLocalWorkspace: true,
    localWorkspaceMessage: "Workspace unavailable.",
    isActiveHost: true,
    hostGateMessage: "Only the active host can edit files.",
    selectedRoom: room,
    selectedRoomIdRef,
    isSelectedRoomLocked: false,
    isSelectedRoomRevoked: false,
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-1",
    relayStatus: "closed",
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set() },
    reportRoomFileActionInFlight: () => false
  });
  useAppStore.getState().setSelectedFileForRoom(room.id, {
    path: "notes.txt",
    content: "Attach me after the actions already exist.",
    size: 42,
    truncated: false
  });

  await actions.attachSelectedFileToMessage();

  const [attachment] = useAppStore.getState().roomChatByRoom[room.id]?.pendingAttachments ?? [];
  assert.equal(attachment?.name, "notes.txt");
  actions.removePendingAttachment(attachment.id);
  assert.deepEqual(useAppStore.getState().roomChatByRoom[room.id]?.pendingAttachments ?? [], []);

  useAppStore.getState().appendFileSaveRequest(room.id, {
    eventType: "workspace.file.save",
    id: "save-after-create",
    requester: "Alex",
    requesterUserId: "github:alex",
    path: "notes.txt",
    previousContent: "before",
    nextContent: "after",
    requestedAt: "2026-07-09T12:00:00.000Z",
    status: "pending"
  });
  actions.denyFileSaveRequest("save-after-create");
  assert.equal(useAppStore.getState().filePanelByRoom[room.id]?.saveRequests?.[0]?.status, "denied");
});

test("file actions preserve a validated inline project image for chat rendering", async () => {
  const actions = createFileActions({
    selectedRoomIdRef: { current: room.id },
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set() },
    reportRoomFileActionInFlight: () => false
  });
  const content = "data:image/png;base64,iVBORw0KGgo=";
  useAppStore.getState().setSelectedFileForRoom(room.id, {
    path: "art/result.png",
    content,
    mediaType: "image/png",
    size: 8,
    truncated: false
  });

  await actions.attachSelectedFileToMessage();

  const [attachment] = useAppStore.getState().roomChatByRoom[room.id]?.pendingAttachments ?? [];
  assert.equal(attachment?.type, "image/png");
  assert.equal(attachment?.content, content);
  assert.equal(attachment?.blobId, undefined);
});

test("git workflow actions report host gating through Zustand without React", async () => {
  const actions = createGitWorkflowActions({
    hasSelectedRoom: true,
    isActiveHost: false,
    canReadLocalWorkspace: true,
    hostGateMessage: "Only the active host can approve this workflow.",
    localWorkspaceMessage: "Workspace unavailable.",
    selectedRoom: room,
    gitWorkflowBusyRef: { current: {} },
    gitWorkflowDraft: defaultGitWorkflowDraft,
    gitApprovalPreview: buildGitWorkflowApprovalPreview(room.projectPath, defaultGitWorkflowDraft),
    githubWorkflowReadiness: checkGitHubWorkflowReadiness({
      pushEnabled: false,
      authConfig: null,
      currentUser: null,
      owner: defaultGitWorkflowDraft.prOwner,
      repo: defaultGitWorkflowDraft.prRepo,
      head: defaultGitWorkflowDraft.branchName,
      base: defaultGitWorkflowDraft.prBase
    }),
    messages: [],
    gitStatus: null,
    maxTerminalActivityLines: 100,
    publishGitWorkflowEvent: async () => undefined,
    refreshGitHubActions: async () => undefined
  });

  useAppStore.getState().replaceCurrentUser(null);
  await actions.approveGitWorkflow();

  assert.equal(
    useAppStore.getState().gitWorkflowRuntimeByRoom[room.id]?.workflow?.message,
    "Only Maddie can approve host-side actions in this room."
  );
});

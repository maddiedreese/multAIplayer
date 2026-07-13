import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";
import { projectGitHubActionsByRoom, projectGitWorkflowByRoom } from "../src/store/slices/gitWorkflowSlice";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("desktop store owns shell, authentication, and host runtime state", () => {
  const store = useAppStore.getState();
  store.setSidebarWidth(320);
  store.setInspectorCollapsed(true);
  store.toggleSidebarCollapsed();
  store.setAuthBusy(true);
  store.setAuthError("Sign-in pending");
  store.replaceCodexProbe({
    available: true,
    version: "0.42.0",
    error: null,
    models: [],
    modelError: null
  });
  store.setDeviceIdentityStatusMessage("Identity ready");
  store.startHistorySearch();

  const state = useAppStore.getState();
  assert.equal(state.sidebarWidth, 320);
  assert.equal(state.inspectorCollapsed, true);
  assert.equal(state.sidebarCollapsed, true);
  assert.equal(state.authBusy, true);
  assert.equal(state.authError, "Sign-in pending");
  assert.equal(state.codexProbe?.available, true);
  assert.equal(state.deviceIdentityMessage, "Identity ready");
  assert.equal(state.historySearchBusy, true);

  state.finishHistorySearch();
  useAppStore.getState().resetAppStore();
  const reset = useAppStore.getState();
  assert.equal(reset.sidebarWidth, 280);
  assert.equal(reset.authBusy, false);
  assert.equal(reset.codexProbe, null);
  assert.equal(reset.historySearchBusy, false);
});

test("desktop store keeps relay access runtime state atomic and resettable", () => {
  const store = useAppStore.getState();

  store.replaceRelayStatus("open");
  store.rememberForgottenRoom("room-a");
  store.revokeWorkspaceAccess("team-a", "room-a");

  let state = useAppStore.getState();
  assert.equal(state.relayStatus, "open");
  assert.equal(state.forgottenRoomIds.has("room-a"), true);
  assert.equal(state.revokedRoomIds.has("room-a"), true);
  assert.equal(state.revokedTeamIds.has("team-a"), true);

  state.restoreWorkspaceAccess("team-a", "room-a");
  state = useAppStore.getState();
  assert.equal(state.forgottenRoomIds.has("room-a"), true);
  assert.equal(state.revokedRoomIds.has("room-a"), false);
  assert.equal(state.revokedTeamIds.has("team-a"), false);

  state.restoreForgottenRoom("room-a");
  assert.equal(useAppStore.getState().forgottenRoomIds.has("room-a"), false);

  state.revokeRoomAccess("room-b");
  state.revokeTeamAccess("team-b");
  state.resetAppStore();
  state = useAppStore.getState();
  assert.equal(state.relayStatus, "closed");
  assert.equal(state.revokedRoomIds.size, 0);
  assert.equal(state.revokedTeamIds.size, 0);
});

test("desktop store keeps git workflow state room scoped", () => {
  const store = useAppStore.getState();

  store.setGitWorkflowBusyForRoom("room-a", true);
  store.setGitWorkflowMessageForRoom("room-a", "Creating PR");
  store.setGitWorkflowMessageForRoom("room-b", null);
  store.setGitStatusForRoom("room-a", {
    branch: "main",
    files: [{ path: "apps/desktop/src/App.tsx", status: "modified", added: 2, removed: 1 }]
  });
  store.editGitWorkflowDraftForRoom("room-b", { branchName: "multaiplayer/alpha" });

  const state = useAppStore.getState();
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.busy, true);
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "Creating PR");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.message, null);
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.status?.files[0]?.path,
    "apps/desktop/src/App.tsx"
  );
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.draft?.branchName,
    "multaiplayer/alpha"
  );
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.draft?.prBase, "main");
});

test("desktop store exposes room git workflow actions", () => {
  const store = useAppStore.getState();

  store.setGitWorkflowMessageForRoom("room-a", "Creating PR");
  store.setGitWorkflowMessageForRoom("room-b", null);
  store.setGitStatusForRoom("room-a", {
    branch: "main",
    files: [{ path: "apps/desktop/src/App.tsx", status: "modified", added: 2, removed: 1 }]
  });
  store.setGitStatusForRoom("room-b", null);
  store.editGitWorkflowDraftForRoom("room-a", { branchName: "multaiplayer/alpha" });
  store.editGitWorkflowDraftForRoom("room-a", { commitMessage: "Build alpha" });

  const state = useAppStore.getState();
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "Creating PR");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.message, null);
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.status?.files[0]?.path,
    "apps/desktop/src/App.tsx"
  );
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.status, null);
  assert.equal(
    projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.branchName,
    "multaiplayer/alpha"
  );
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.commitMessage, "Build alpha");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prBase, "main");
});

test("desktop store applies inferred GitHub remotes only to default draft targets", () => {
  const store = useAppStore.getState();

  assert.equal(store.applyInferredGitHubRemoteForRoom("room-a", { owner: "openai", repo: "codex" }), true);
  assert.equal(
    projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prOwner,
    "openai"
  );
  assert.equal(
    projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prRepo,
    "codex"
  );

  store.editGitWorkflowDraftForRoom("room-b", { prOwner: "maddiedreese", prRepo: "custom" });

  assert.equal(store.applyInferredGitHubRemoteForRoom("room-b", { owner: "openai", repo: "codex" }), false);
  assert.equal(
    projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-b"]?.draft?.prOwner,
    "maddiedreese"
  );
  assert.equal(
    projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-b"]?.draft?.prRepo,
    "custom"
  );
});

test("desktop store exposes room busy actions", () => {
  const store = useAppStore.getState();

  store.setGitWorkflowBusyForRoom("room-a", true);
  store.setActionsBusyForRoom("room-a", true);
  store.setLocalPreviewBusyForRoom("room-a", true);
  store.setHostBusyForRoom("room-a", true);
  store.setSettingsBusyForRoom("room-a", true);
  store.setMembershipCommitBusyForRoom("room-a", true);
  store.setFileBusyForRoom("room-a", true);
  store.setTerminalBusyForRoom("room-a", true);
  store.setGitWorkflowBusyForRoom("room-b", true);
  store.setGitWorkflowBusyForRoom("room-a", false);

  const state = useAppStore.getState();
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.busy, undefined);
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.busy, true);
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.busy, true);
  assert.equal(state.localPreviewByRoom["room-a"]?.busy, true);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostBusy, true);
  assert.equal(state.roomSettingsByRoom["room-a"]?.settingsBusy, true);
  assert.equal(state.inviteByRoom["room-a"]?.membershipCommitBusy, true);
  assert.equal(state.filePanelByRoom["room-a"]?.busy, true);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.busy, true);
});

test("desktop store exposes room request actions", () => {
  const store = useAppStore.getState();

  store.appendInviteRequest("room-a", {
    eventType: "invite.request",
    id: "invite-request-a",
    requester: "Avery",
    requesterUserId: "github:avery",
    requesterDeviceId: "device-a",
    requestedAt: "2026-07-06T00:02:00.000Z",
    status: "pending"
  });
  store.updateInviteRequestStatus("room-a", "invite-request-a", "approved");
  store.appendTerminalRequest("room-a", {
    id: "terminal-request-a",
    requester: "Avery",
    requesterUserId: "github:avery",
    command: "npm test",
    cwd: "/Users/maddiedreese/Documents/MultAIplayer",
    requestedAt: "2026-07-06T00:03:00.000Z",
    status: "pending"
  });
  store.appendTerminalRequest("room-a", {
    id: "terminal-request-a",
    requester: "Avery",
    requesterUserId: "github:avery",
    command: "npm test",
    cwd: "/Users/maddiedreese/Documents/MultAIplayer",
    requestedAt: "2026-07-06T00:03:00.000Z",
    status: "pending"
  });
  store.updateTerminalRequestStatus("room-a", "terminal-request-a", "denied");
  store.appendBrowserRequest("room-a", {
    id: "browser-request-a",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    url: "http://localhost:5173",
    reason: "Inspect local preview",
    requestedAt: "2026-07-06T00:04:00.000Z",
    status: "pending"
  });
  store.updateBrowserRequestStatus("room-a", "browser-request-a", "approved");

  const state = useAppStore.getState();
  assert.equal(state.inviteByRoom["room-a"]?.requests?.[0]?.status, "approved");
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.requests?.length, 1);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.requests?.[0]?.status, "denied");
  assert.equal(state.browserByRoom["room-a"]?.requests?.[0]?.status, "approved");
});

test("desktop store keeps GitHub Actions state room scoped", () => {
  const store = useAppStore.getState();

  store.setActionsBusyForRoom("room-a", true);
  store.setActionsMessageForRoom("room-a", "Refreshing Actions");
  store.setActionsMessageForRoom("room-b", null);
  store.recordGitHubActionsRefreshForRoom("room-a", {
    message: "Refreshing Actions",
    checkedAt: "2026-07-06T00:02:00.000Z",
    runs: [
      {
        id: 18,
        name: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/maddiedreese/multAIplayer/actions/runs/18",
        branch: "main",
        event: "push",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:01:00.000Z"
      }
    ]
  });

  const state = useAppStore.getState();
  assert.deepEqual(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"], {
    busy: true,
    message: "Refreshing Actions",
    runs: [
      {
        id: 18,
        name: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/maddiedreese/multAIplayer/actions/runs/18",
        branch: "main",
        event: "push",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:01:00.000Z"
      }
    ],
    lastChecked: "2026-07-06T00:02:00.000Z"
  });
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-b"], undefined);
});

test("desktop store exposes GitHub Actions room actions", () => {
  const store = useAppStore.getState();
  const run = {
    id: 42,
    name: "macOS desktop package",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/maddiedreese/multAIplayer/actions/runs/42",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:01:00.000Z"
  };

  store.setActionsBusyForRoom("room-a", true);
  store.setActionsMessageForRoom("room-a", "Checking Actions");
  store.recordGitHubActionsRefreshForRoom("room-a", {
    runs: [run],
    checkedAt: "2026-07-06T00:01:00.000Z",
    message: "Checking Actions"
  });

  let state = useAppStore.getState();
  assert.deepEqual(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"], {
    busy: true,
    message: "Checking Actions",
    runs: [run],
    lastChecked: "2026-07-06T00:01:00.000Z"
  });

  store.resetGitHubActionsStateForRoom("room-a");

  state = useAppStore.getState();
  assert.deepEqual(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"], { runs: [] });
});

test("desktop store applies GitHub Actions events as one room-scoped state update", () => {
  const store = useAppStore.getState();
  const event = {
    eventType: "github.actions" as const,
    checkedBy: "Maddie",
    checkedByUserId: "github:maddie",
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "main",
    checkedAt: "2026-07-06T00:03:00.000Z",
    summary: { label: "Passing", detail: "Latest loaded workflow runs are passing.", tone: "green" as const },
    message: "Loaded 1 workflow run for main.",
    runs: [
      {
        id: 7,
        name: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/maddiedreese/multAIplayer/actions/runs/7",
        branch: "main",
        event: "push",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:01:00.000Z"
      }
    ]
  };

  store.applyGitHubActionsEventForRoom("room-a", event);
  store.applyGitHubActionsEventForRoom("room-a", event);

  const state = useAppStore.getState();
  assert.deepEqual(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"], {
    events: [event],
    runs: event.runs,
    lastChecked: event.checkedAt,
    message: "Passing: Loaded 1 workflow run for main."
  });
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.length, 1);
});

test("desktop store keeps browser panel state room scoped", () => {
  const store = useAppStore.getState();

  store.appendBrowserRequest("room-a", {
    id: "browser-request-1",
    requester: "Avery",
    requesterUserId: "github:avery",
    url: "http://localhost:3000",
    reason: "Inspect local preview",
    requestedAt: "2026-07-06T00:03:00.000Z",
    status: "pending"
  });
  store.setBrowserUrlForRoom("room-a", "https://github.com", "http://localhost:3000");
  store.setBrowserUrlForRoom("room-b", "http://localhost:5173", "http://localhost:3000");
  store.setBrowserReasonForRoom("room-b", "Open app preview", "Use this page as Codex browser context.");
  store.setBrowserMessageForRoom("room-a", "Opened browser");
  store.openEmbeddedBrowserForRoom("room-a", "https://github.com");

  const state = useAppStore.getState();
  assert.equal(state.browserByRoom["room-a"]?.requests?.[0]?.url, "http://localhost:3000");
  assert.equal(state.browserByRoom["room-b"]?.url, "http://localhost:5173");
  assert.equal(state.browserByRoom["room-b"]?.reason, "Open app preview");
  assert.equal(state.browserByRoom["room-a"]?.message, "Opened browser");
  assert.equal(state.browserByRoom["room-b"]?.message, undefined);
  assert.equal(state.browserByRoom["room-a"]?.status?.profilePath, "Embedded in this room");
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, "https://github.com");
  assert.equal(state.browserByRoom["room-a"]?.tabs?.length, 1);
  assert.equal(state.browserByRoom["room-a"]?.tabs?.[0]?.url, "https://github.com");
  assert.equal(state.browserByRoom["room-a"]?.activeTabId, state.browserByRoom["room-a"]?.tabs?.[0]?.id);
  assert.equal(state.browserByRoom["room-b"]?.activeUrl, undefined);
});

test("desktop store exposes room browser actions", () => {
  const store = useAppStore.getState();
  const defaultUrl = "https://github.com/maddiedreese/multAIplayer";
  const defaultReason = "Use this page as Codex browser context.";

  store.setBrowserUrlForRoom("room-a", "http://localhost:5173", defaultUrl);
  store.setBrowserReasonForRoom("room-a", "Inspect local preview", defaultReason);
  store.setBrowserMessageForRoom("room-a", "Opened browser");
  store.setBrowserUrlForRoom("room-b", defaultUrl, defaultUrl);
  store.setBrowserReasonForRoom("room-b", defaultReason, defaultReason);
  store.setBrowserMessageForRoom("room-a", null);
  store.openEmbeddedBrowserForRoom("room-a", "http://localhost:5173");
  store.setInspectorTabForRoom("room-a", "browser");
  store.resetEmbeddedBrowserForRoom("room-b", "/tmp/browser-profile");
  store.clearBrowserStatusForRoom("room-a");

  const state = useAppStore.getState();
  assert.equal(state.browserByRoom["room-a"]?.url, "http://localhost:5173");
  assert.equal(state.browserByRoom["room-a"]?.reason, "Inspect local preview");
  assert.equal(state.browserByRoom["room-a"]?.message, undefined);
  assert.equal(state.browserByRoom["room-b"]?.url, undefined);
  assert.equal(state.browserByRoom["room-b"]?.reason, undefined);
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, undefined);
  assert.equal(state.browserByRoom["room-a"]?.tabs, undefined);
  assert.equal(state.browserByRoom["room-a"]?.activeTabId, undefined);
  assert.equal(state.browserByRoom["room-a"]?.status, undefined);
  assert.equal(state.historyPresenceByRoom["room-a"]?.inspectorTab, "browser");
  assert.equal(state.browserByRoom["room-b"]?.activeUrl, undefined);
  assert.equal(state.browserByRoom["room-b"]?.status?.profilePath, "/tmp/browser-profile");
});

test("desktop store supports multiple room browser tabs", () => {
  const store = useAppStore.getState();

  store.openEmbeddedBrowserForRoom("room-a", "https://example.com");
  store.openEmbeddedBrowserForRoom("room-a", "http://localhost:5173");
  store.openEmbeddedBrowserForRoom("room-b", "https://github.com");

  let state = useAppStore.getState();
  const roomATabs = state.browserByRoom["room-a"]?.tabs ?? [];
  assert.equal(roomATabs.length, 2);
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, "http://localhost:5173");
  assert.equal(state.browserByRoom["room-b"]?.tabs?.length, 1);

  store.selectBrowserTabForRoom("room-a", roomATabs[0].id);
  state = useAppStore.getState();
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, "https://example.com");
  assert.equal(state.browserByRoom["room-a"]?.activeTabId, roomATabs[0].id);

  store.closeBrowserTabForRoom("room-a", roomATabs[0].id);
  state = useAppStore.getState();
  assert.equal(state.browserByRoom["room-a"]?.tabs?.length, 1);
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, "http://localhost:5173");

  store.closeBrowserTabForRoom("room-a", roomATabs[1].id);
  state = useAppStore.getState();
  assert.equal(state.browserByRoom["room-a"]?.tabs, undefined);
  assert.equal(state.browserByRoom["room-a"]?.activeUrl, undefined);
  assert.equal(state.browserByRoom["room-b"]?.activeUrl, "https://github.com");
});

test("desktop store keeps file panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setFileQueryForRoom("room-a", "README");
  store.setFileQueryForRoom("room-b", ".env");
  store.setProjectFilesForRoom("room-a", [
    { path: "README.md", size: 2048 },
    { path: "apps/desktop/src/App.tsx", size: 4096 }
  ]);
  store.setSelectedFileForRoom("room-a", {
    path: "README.md",
    size: 2048,
    truncated: false,
    content: "# multAIplayer"
  });
  store.setSelectedDiffForRoom("room-a", {
    path: "README.md",
    diff: "@@ -1 +1 @@\n-old\n+new"
  });
  store.setFilePreviewTabForRoom("room-a", "diff");
  store.setFileBusyForRoom("room-a", true);
  store.setFileMessageForRoom("room-a", "Loaded README.md");
  store.appendFileSaveRequest("room-a", {
    eventType: "workspace.file.save",
    id: "file-save-1",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    path: "README.md",
    previousContent: "# multAIplayer\n",
    nextContent: "# multAIplayer\n\nAlpha notes\n",
    requestedAt: "2026-07-08T12:00:00.000Z",
    status: "pending"
  });
  store.updateFileSaveRequestStatus("room-a", "file-save-1", "approved");
  store.setMarkdownCopyFallbackForRoom("room-a", {
    title: "README.md",
    markdown: "# multAIplayer"
  });

  const state = useAppStore.getState();
  assert.equal(state.filePanelByRoom["room-b"]?.query, ".env");
  assert.equal(state.filePanelByRoom["room-a"]?.projectFiles?.[1]?.path, "apps/desktop/src/App.tsx");
  assert.equal(state.filePanelByRoom["room-a"]?.selectedFile?.content, "# multAIplayer");
  assert.equal(state.filePanelByRoom["room-b"]?.selectedFile, undefined);
  assert.equal(state.filePanelByRoom["room-a"]?.selectedDiff?.path, "README.md");
  assert.equal(state.filePanelByRoom["room-a"]?.previewTab, "diff");
  assert.equal(state.filePanelByRoom["room-a"]?.busy, true);
  assert.equal(state.filePanelByRoom["room-a"]?.message, "Loaded README.md");
  assert.equal(state.filePanelByRoom["room-b"]?.message, undefined);
  assert.equal(state.filePanelByRoom["room-a"]?.saveRequests?.[0]?.status, "approved");
  assert.equal(state.filePanelByRoom["room-b"]?.saveRequests, undefined);
  assert.equal(state.filePanelByRoom["room-a"]?.markdownCopyFallback?.title, "README.md");
});

test("desktop store exposes room file panel actions", () => {
  const store = useAppStore.getState();

  store.setFileQueryForRoom("room-a", "README");
  store.setProjectFilesForRoom("room-a", [{ path: "README.md", size: 2048 }]);
  store.setSelectedFileForRoom("room-a", {
    path: "README.md",
    size: 2048,
    truncated: false,
    content: "# multAIplayer"
  });
  store.setSelectedDiffForRoom("room-a", {
    path: "README.md",
    diff: "@@ -1 +1 @@\n-old\n+new"
  });
  store.setFilePreviewTabForRoom("room-a", "diff");
  store.setFileBusyForRoom("room-a", true);
  store.setFileMessageForRoom("room-a", "Loaded README.md");
  store.appendFileSaveRequest("room-a", {
    eventType: "workspace.file.save",
    id: "file-save-1",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    path: "README.md",
    previousContent: "# multAIplayer\n",
    nextContent: "# multAIplayer\n\nAlpha notes\n",
    requestedAt: "2026-07-08T12:00:00.000Z",
    status: "pending"
  });
  store.setFileQueryForRoom("room-b", "LICENSE");
  store.setFilePreviewTabForRoom("room-b", "file");
  store.resetFileContextForRoom("room-a");

  const state = useAppStore.getState();
  assert.deepEqual(state.filePanelByRoom["room-a"], {
    previewTab: "diff",
    saveRequests: [
      {
        eventType: "workspace.file.save",
        id: "file-save-1",
        requester: "Maddie",
        requesterUserId: "github:maddie",
        path: "README.md",
        previousContent: "# multAIplayer\n",
        nextContent: "# multAIplayer\n\nAlpha notes\n",
        requestedAt: "2026-07-08T12:00:00.000Z",
        status: "pending"
      }
    ]
  });
  assert.equal(state.filePanelByRoom["room-b"]?.query, "LICENSE");
  assert.equal(state.filePanelByRoom["room-b"]?.previewTab, undefined);
});

test("desktop store keeps room settings state room scoped", () => {
  const store = useAppStore.getState();

  store.setHostBusyForRoom("room-a", true);
  store.setHostMessageForRoom("room-a", "Host updated");
  store.setHostMessageForRoom("room-b", null);
  store.setSettingsBusyForRoom("room-b", true);
  store.setSettingsMessageForRoom("room-a", "Settings saved");
  store.setCustomCodexModelForRoom("room-a", "gpt-5.4", "gpt-5.3");
  store.setCustomCodexModelForRoom("room-b", "o4-mini", "gpt-5.3");
  store.setProjectPathDraftForRoom("room-a", "/Users/maddiedreese/Documents/MultAIplayer", "/tmp/current-project");
  store.setProjectPathDraftForRoom("room-b", "/tmp/example", "/tmp/current-project");

  const state = useAppStore.getState();
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostBusy, true);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Host updated");
  assert.equal(state.roomSettingsByRoom["room-b"]?.hostMessage, undefined);
  assert.equal(state.roomSettingsByRoom["room-b"]?.settingsBusy, true);
  assert.equal(state.roomSettingsByRoom["room-a"]?.settingsMessage, "Settings saved");
  assert.equal(state.roomSettingsByRoom["room-a"]?.customCodexModel, "gpt-5.4");
  assert.equal(state.roomSettingsByRoom["room-b"]?.projectPathDraft, "/tmp/example");
});

test("desktop store exposes room project override actions", () => {
  const store = useAppStore.getState();

  store.setCustomCodexModelForRoom("room-a", "gpt-5.4", "gpt-5.3");
  store.setProjectPathDraftForRoom("room-a", "/tmp/example", "/Users/maddiedreese/Documents/MultAIplayer");
  store.setCustomCodexModelForRoom("room-b", "gpt-5.4", "gpt-5.4");
  store.setProjectPathDraftForRoom("room-b", "/tmp/example", "/tmp/example");
  store.setCustomCodexModelForRoom("room-a", "gpt-5.3", "gpt-5.3");

  const state = useAppStore.getState();
  assert.equal(state.roomSettingsByRoom["room-a"]?.customCodexModel, undefined);
  assert.equal(state.roomSettingsByRoom["room-a"]?.projectPathDraft, "/tmp/example");
  assert.equal(state.roomSettingsByRoom["room-b"]?.customCodexModel, undefined);
  assert.equal(state.roomSettingsByRoom["room-b"]?.projectPathDraft, undefined);
});

test("desktop store keeps local preview state room scoped", () => {
  const store = useAppStore.getState();

  store.appendLocalPreviewEvent("room-a", {
    eventType: "local.preview",
    id: "preview-1",
    sharedBy: "Avery",
    sharedByUserId: "github:avery",
    sourceUrl: "http://localhost:5173/",
    publicUrl: "https://preview.trycloudflare.com",
    status: "live",
    message: "Preview is live",
    createdAt: "2026-07-06T00:04:00.000Z",
    updatedAt: "2026-07-06T00:05:00.000Z"
  });
  store.setLocalPreviewBusyForRoom("room-a", true);
  store.setLocalPreviewBusyForRoom("room-b", false);
  store.openLocalPreviewDialogForRoom("room-a");
  store.setLocalPreviewDialogCandidates([{ url: "http://localhost:5173/", label: "localhost:5173" }], null);
  store.setLocalPreviewDialogConfirmation("room-a", "http://localhost:5173/", "2026.7.0");

  const state = useAppStore.getState();
  assert.equal(state.localPreviewByRoom["room-a"]?.previews?.[0]?.status, "live");
  assert.equal(state.localPreviewByRoom["room-a"]?.busy, true);
  assert.equal(state.localPreviewByRoom["room-b"]?.busy, undefined);
  assert.equal(state.localPreviewDialog.open, true);
  assert.equal(state.localPreviewDialog.candidates[0]?.label, "localhost:5173");
});

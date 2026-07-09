import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";
import {
  projectGitHubActionsByRoom,
  projectGitWorkflowByRoom
} from "../src/store/slices/gitWorkflowSlice";
import { projectInvitePanelMaps } from "../src/store/slices/inviteSlice";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
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
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.status?.files[0]?.path, "apps/desktop/src/App.tsx");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.draft?.branchName, "multaiplayer/alpha");
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
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.status?.files[0]?.path, "apps/desktop/src/App.tsx");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.status, null);
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.branchName, "multaiplayer/alpha");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.commitMessage, "Build alpha");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prBase, "main");
});

test("desktop store applies inferred GitHub remotes only to default draft targets", () => {
  const store = useAppStore.getState();

  assert.equal(
    store.applyInferredGitHubRemoteForRoom("room-a", { owner: "openai", repo: "codex" }),
    true
  );
  assert.equal(projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prOwner, "openai");
  assert.equal(projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-a"]?.draft?.prRepo, "codex");

  store.editGitWorkflowDraftForRoom("room-b", { prOwner: "maddiedreese", prRepo: "custom" });

  assert.equal(
    store.applyInferredGitHubRemoteForRoom("room-b", { owner: "openai", repo: "codex" }),
    false
  );
  assert.equal(projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-b"]?.draft?.prOwner, "maddiedreese");
  assert.equal(projectGitWorkflowByRoom(useAppStore.getState().gitWorkflowRuntimeByRoom)["room-b"]?.draft?.prRepo, "custom");
});

test("desktop store exposes room busy actions", () => {
  const store = useAppStore.getState();

  store.setGitWorkflowBusyForRoom("room-a", true);
  store.setActionsBusyForRoom("room-a", true);
  store.setLocalPreviewBusyForRoom("room-a", true);
  store.setHostBusyForRoom("room-a", true);
  store.setSettingsBusyForRoom("room-a", true);
  store.setKeyRotationBusyForRoom("room-a", true);
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
  assert.equal(state.inviteByRoom["room-a"]?.keyRotationBusy, true);
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
    runs: [{
      id: 7,
      name: "CI",
      status: "completed",
      conclusion: "success",
      url: "https://github.com/maddiedreese/multAIplayer/actions/runs/7",
      branch: "main",
      event: "push",
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:01:00.000Z"
    }]
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
  store.setProjectPathDraftForRoom(
    "room-a",
    "/Users/maddiedreese/Documents/MultAIplayer",
    "/tmp/current-project"
  );
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

test("desktop store keeps invite panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setInviteRequestsForRoom("room-a", [{
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
  }]);
  store.setInviteSecretInputValue("multaiplayer://invite#secret");
  store.setInviteLinkForRoom("room-a", "https://multaiplayer.com/invite/room-a");
  store.setInviteApprovalGateForRoom("room-a", true);
  store.setInviteApprovalGateForRoom("room-b", false);
  store.setInviteMessageForRoom("room-a", "Invite created");
  store.setInviteMessageForRoom("room-b", null);
  store.setKeyRotationBusyForRoom("room-a", true);
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
  assert.equal(state.inviteByRoom["room-a"]?.keyRotationBusy, true);
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
  assert.deepEqual(state.roomChatByRoom["room-a"]?.pendingAttachments?.map((attachment) => attachment.name), ["README.md", "plan.md"]);

  store.removePendingAttachmentForRoom("room-a", "attachment-1");
  state = useAppStore.getState();
  assert.deepEqual(state.roomChatByRoom["room-a"]?.pendingAttachments?.map((attachment) => attachment.name), ["plan.md"]);

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
  assert.equal(state.codexRuntimeByRoom["room-a"]?.pendingApproval?.summary.workspacePath, "/Users/maddiedreese/Documents/MultAIplayer");
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
  assert.deepEqual(state.chatEditsByRoom["room-a"], [{
    id: "edit-1",
    messageId: "message-1",
    body: "@Codex draft a safer plan",
    editedBy: "Maddie",
    editedByUserId: "github:maddie",
    editedAt: "2026-07-08T12:01:00.000Z"
  }]);

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
  assert.deepEqual(state.chatDeletesByRoom["room-a"], [{
    id: "delete-2",
    messageId: "message-2",
    deletedBy: "Jordan",
    deletedByUserId: "github:jordan",
    deletedAt: "2026-07-08T12:03:00.000Z"
  }]);
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
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.map((turn) => turn.turnId), ["turn-queued-1", "turn-queued-2"]);

  store.removeQueuedCodexApprovalForRoom("room-a", "turn-queued-2");

  state = useAppStore.getState();
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.map((turn) => turn.turnId), ["turn-queued-1"]);
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
  store.appendGitHubActionsEvent(
    "room-b",
      {
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
      }
  );

  const state = useAppStore.getState();
  assert.equal(state.historyPresenceByRoom["room-a"]?.inspectorTab, "files");
  assert.equal(state.historyPresenceByRoom["room-b"]?.inspectorTab, "terminal");
  assert.equal(state.historyPresenceByRoom["room-a"]?.presence, undefined);
  assert.equal(state.historyPresenceByRoom["room-b"]?.presence?.["device-b"]?.displayName, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.reason, "usage_limit");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.continuation?.acceptedBy, "Jordan");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.branch, "codex/runtime-state");
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-b"]?.events?.[0]?.summary.tone, "green");
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
    "room-a": [{
      id: "history-search-a",
      author: "Avery",
      role: "human",
      body: "Clear search result",
      time: "10:01"
    }],
    "room-b": [{
      id: "history-search-b",
      author: "Jordan",
      role: "human",
      body: "Keep search result",
      time: "10:02"
    }]
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
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadId, undefined);
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
  assert.equal(state.terminals.some((terminal) => terminal.roomId === "room-a"), false);
  assert.equal(state.browserByRoom["room-a"]?.url, undefined);
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "keep");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.events?.[0]?.turnId, "turn-b");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.threadId, "thread-b");
  assert.equal(state.historyPresenceByRoom["room-b"]?.searchMessages?.[0]?.body, "Keep search result");
  assert.equal(state.historyPresenceByRoom["room-b"]?.inspectorTab, "terminal");
  assert.equal(state.historyPresenceByRoom["room-b"]?.presence?.["device-b"]?.displayName, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-b"]?.continuation?.acceptedBy, "Jordan");
  assert.deepEqual(state.roomChatByRoom["room-b"]?.selectedMessageIds, ["message-b"]);
  assert.equal(state.terminals.some((terminal) => terminal.roomId === "room-b"), true);
  assert.equal(state.browserByRoom["room-b"]?.url, "https://example.com");
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

test("desktop store seeds initial workspace data only when maps are empty", () => {
  const store = useAppStore.getState();

  store.seedWorkspaceInitialDataIfEmpty({
    teamMembersByTeam: {
      "team-core": [
        {
          teamId: "team-core",
          userId: "github:maddie",
          role: "owner",
          joinedAt: "2026-07-06T00:17:00.000Z"
        }
      ]
    },
    messagesByRoom: {
      "room-a": [{ id: "message-a", author: "Avery", role: "human", body: "Seeded", time: "10:17" }]
    }
  });

  let state = useAppStore.getState();
  assert.equal(state.teamRosterByTeam["team-core"]?.members?.[0]?.userId, "github:maddie");
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.body, "Seeded");

  store.seedWorkspaceInitialDataIfEmpty({
    teamMembersByTeam: {
      "team-labs": [
        {
          teamId: "team-labs",
          userId: "github:labs",
          role: "member",
          joinedAt: "2026-07-06T00:18:00.000Z"
        }
      ]
    },
    messagesByRoom: {
      "room-b": [{ id: "message-b", author: "Jordan", role: "human", body: "Do not merge", time: "10:18" }]
    }
  });

  state = useAppStore.getState();
  assert.equal(state.teamRosterByTeam["team-labs"]?.members, undefined);
  assert.equal(state.messagesByRoom["room-b"], undefined);
});

test("desktop store hydrates local room history through one room-scoped action", () => {
  const store = useAppStore.getState();

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
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
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
    codexThreadId: "thread-a"
  });

  const state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.body, "Restore this room.");
  assert.equal(state.chatEditsByRoom["room-a"]?.[0]?.body, "Restore this edited room.");
  assert.equal(state.chatDeletesByRoom["room-a"]?.[0]?.messageId, "message-old");
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "Keep this room alone.");
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.requests?.[0]?.command, "npm test");
  assert.equal(state.browserByRoom["room-a"]?.requests?.[0]?.url, "http://localhost:5173");
  assert.equal(state.inviteByRoom["room-a"]?.requests?.[0]?.requester, "Jordan");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.events?.[0]?.message, "Reading context");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.branch, "codex/history-hydration");
  assert.equal(projectGitWorkflowByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "Opened draft PR");
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.events?.[0]?.runs[0]?.name, "Web, relay, and packages");
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.runs?.[0]?.id, 18);
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.lastChecked, "2026-07-06T00:08:00.000Z");
  assert.equal(projectGitHubActionsByRoom(state.gitWorkflowRuntimeByRoom)["room-a"]?.message, "CI: Checked Actions");
  assert.equal(state.localPreviewByRoom["room-a"]?.previews?.[0]?.status, "live");
  assert.equal(state.terminals.some((terminal) => terminal.id === "terminal-a"), true);
  assert.equal(state.terminals.some((terminal) => terminal.id === "terminal-b"), true);
  assert.equal(state.terminalRuntimeByRoom["room-a"]?.selectedTerminalId, "terminal-a");
  assert.equal(state.terminalRuntimeByRoom["room-b"]?.selectedTerminalId, "terminal-b");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.hostHandoffs?.[0]?.reason, "usage_limit");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals?.[0]?.turnId, "turn-queued-1");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.goal?.text, "Finish encrypted history polish");
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadId, "thread-a");
});

test("desktop store clears stale Codex handoff history when hydrating an empty room payload", () => {
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
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
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
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.events, []);
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.hostHandoffs, []);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.threadId, undefined);
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

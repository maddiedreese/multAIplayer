import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";

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
  store.updateGitWorkflowDraftForRoom("room-b", { branchName: "multaiplayer/alpha" });

  const state = useAppStore.getState();
  assert.equal(state.gitWorkflowBusyByRoom["room-a"], true);
  assert.equal(state.gitWorkflowMessagesByRoom["room-a"], "Creating PR");
  assert.equal(state.gitWorkflowMessagesByRoom["room-b"], null);
  assert.equal(state.gitStatusByRoom["room-a"]?.files[0]?.path, "apps/desktop/src/App.tsx");
  assert.equal(state.gitWorkflowDraftsByRoom["room-b"]?.branchName, "multaiplayer/alpha");
  assert.equal(state.gitWorkflowDraftsByRoom["room-b"]?.prBase, "main");
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
  store.updateGitWorkflowDraftForRoom("room-a", { branchName: "multaiplayer/alpha" });
  store.updateGitWorkflowDraftForRoom("room-a", { commitMessage: "Build alpha" });

  const state = useAppStore.getState();
  assert.equal(state.gitWorkflowMessagesByRoom["room-a"], "Creating PR");
  assert.equal(state.gitWorkflowMessagesByRoom["room-b"], null);
  assert.equal(state.gitStatusByRoom["room-a"]?.files[0]?.path, "apps/desktop/src/App.tsx");
  assert.equal(state.gitStatusByRoom["room-b"], null);
  assert.equal(state.gitWorkflowDraftsByRoom["room-a"]?.branchName, "multaiplayer/alpha");
  assert.equal(state.gitWorkflowDraftsByRoom["room-a"]?.commitMessage, "Build alpha");
  assert.equal(state.gitWorkflowDraftsByRoom["room-a"]?.prBase, "main");
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
  assert.equal(state.gitWorkflowBusyByRoom["room-a"], undefined);
  assert.equal(state.gitWorkflowBusyByRoom["room-b"], true);
  assert.equal(state.githubActionsByRoom["room-a"]?.busy, true);
  assert.equal(state.localPreviewBusyByRoom["room-a"], true);
  assert.equal(state.hostBusyByRoom["room-a"], true);
  assert.equal(state.settingsBusyByRoom["room-a"], true);
  assert.equal(state.keyRotationBusyByRoom["room-a"], true);
  assert.equal(state.fileBusyByRoom["room-a"], true);
  assert.equal(state.terminalBusyByRoom["room-a"], true);
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
  assert.equal(state.inviteRequestsByRoom["room-a"]?.[0]?.status, "approved");
  assert.equal(state.terminalRequestsByRoom["room-a"]?.length, 1);
  assert.equal(state.terminalRequestsByRoom["room-a"]?.[0]?.status, "denied");
  assert.equal(state.browserRequestsByRoom["room-a"]?.[0]?.status, "approved");
});

test("desktop store keeps GitHub Actions state room scoped", () => {
  const store = useAppStore.getState();

  store.setActionsBusyForRoom("room-a", true);
  store.setActionsMessageForRoom("room-a", "Refreshing Actions");
  store.setActionsMessageForRoom("room-b", null);
  store.setActionRunsForRoom("room-a", [
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
  ]);
  store.setActionsLastCheckedForRoom("room-a", "2026-07-06T00:02:00.000Z");

  const state = useAppStore.getState();
  assert.deepEqual(state.githubActionsByRoom["room-a"], {
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
  assert.equal(state.githubActionsByRoom["room-b"], undefined);
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
  store.setActionRunsForRoom("room-a", [run]);
  store.setActionsLastCheckedForRoom("room-a", "2026-07-06T00:01:00.000Z");

  let state = useAppStore.getState();
  assert.deepEqual(state.githubActionsByRoom["room-a"], {
    busy: true,
    message: "Checking Actions",
    runs: [run],
    lastChecked: "2026-07-06T00:01:00.000Z"
  });

  store.resetGitHubActionsStateForRoom("room-a");

  state = useAppStore.getState();
  assert.deepEqual(state.githubActionsByRoom["room-a"], { runs: [] });
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
  assert.equal(state.browserRequestsByRoom["room-a"]?.[0]?.url, "http://localhost:3000");
  assert.equal(state.browserUrlsByRoom["room-b"], "http://localhost:5173");
  assert.equal(state.browserReasonsByRoom["room-b"], "Open app preview");
  assert.equal(state.browserMessagesByRoom["room-a"], "Opened browser");
  assert.equal(state.browserMessagesByRoom["room-b"], undefined);
  assert.equal(state.browserStatusByRoom["room-a"]?.profilePath, "Embedded in this room");
  assert.equal(state.activeBrowserUrlsByRoom["room-a"], "https://github.com");
  assert.equal(state.activeBrowserUrlsByRoom["room-b"], undefined);
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
  assert.equal(state.browserUrlsByRoom["room-a"], "http://localhost:5173");
  assert.equal(state.browserReasonsByRoom["room-a"], "Inspect local preview");
  assert.equal(state.browserMessagesByRoom["room-a"], undefined);
  assert.equal(state.browserUrlsByRoom["room-b"], undefined);
  assert.equal(state.browserReasonsByRoom["room-b"], undefined);
  assert.equal(state.activeBrowserUrlsByRoom["room-a"], undefined);
  assert.equal(state.browserStatusByRoom["room-a"], undefined);
  assert.equal(state.inspectorTabsByRoom["room-a"], "browser");
  assert.equal(state.activeBrowserUrlsByRoom["room-b"], undefined);
  assert.equal(state.browserStatusByRoom["room-b"]?.profilePath, "/tmp/browser-profile");
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
  store.setMarkdownCopyFallbackForRoom("room-a", {
    title: "README.md",
    markdown: "# multAIplayer"
  });

  const state = useAppStore.getState();
  assert.equal(state.fileQueriesByRoom["room-b"], ".env");
  assert.equal(state.projectFilesByRoom["room-a"]?.[1]?.path, "apps/desktop/src/App.tsx");
  assert.equal(state.selectedFilesByRoom["room-a"]?.content, "# multAIplayer");
  assert.equal(state.selectedFilesByRoom["room-b"], undefined);
  assert.equal(state.selectedDiffsByRoom["room-a"]?.path, "README.md");
  assert.equal(state.filePreviewTabsByRoom["room-a"], "diff");
  assert.equal(state.fileBusyByRoom["room-a"], true);
  assert.equal(state.fileMessagesByRoom["room-a"], "Loaded README.md");
  assert.equal(state.fileMessagesByRoom["room-b"], undefined);
  assert.equal(state.markdownCopyFallbacksByRoom["room-a"]?.title, "README.md");
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
  store.setFileQueryForRoom("room-b", "LICENSE");
  store.setFilePreviewTabForRoom("room-b", "file");
  store.resetFileContextForRoom("room-a");

  const state = useAppStore.getState();
  assert.equal(state.fileQueriesByRoom["room-a"], undefined);
  assert.equal(state.projectFilesByRoom["room-a"], undefined);
  assert.equal(state.selectedFilesByRoom["room-a"], undefined);
  assert.equal(state.selectedDiffsByRoom["room-a"], undefined);
  assert.equal(state.fileBusyByRoom["room-a"], undefined);
  assert.equal(state.fileMessagesByRoom["room-a"], undefined);
  assert.equal(state.fileQueriesByRoom["room-b"], "LICENSE");
  assert.equal(state.filePreviewTabsByRoom["room-b"], undefined);
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
  assert.equal(state.hostBusyByRoom["room-a"], true);
  assert.equal(state.hostMessagesByRoom["room-a"], "Host updated");
  assert.equal(state.hostMessagesByRoom["room-b"], undefined);
  assert.equal(state.settingsBusyByRoom["room-b"], true);
  assert.equal(state.settingsMessagesByRoom["room-a"], "Settings saved");
  assert.equal(state.customCodexModelsByRoom["room-a"], "gpt-5.4");
  assert.equal(state.projectPathDraftsByRoom["room-b"], "/tmp/example");
});

test("desktop store exposes room project override actions", () => {
  const store = useAppStore.getState();

  store.setCustomCodexModelForRoom("room-a", "gpt-5.4", "gpt-5.3");
  store.setProjectPathDraftForRoom("room-a", "/tmp/example", "/Users/maddiedreese/Documents/MultAIplayer");
  store.setCustomCodexModelForRoom("room-b", "gpt-5.4", "gpt-5.4");
  store.setProjectPathDraftForRoom("room-b", "/tmp/example", "/tmp/example");
  store.setCustomCodexModelForRoom("room-a", "gpt-5.3", "gpt-5.3");

  const state = useAppStore.getState();
  assert.equal(state.customCodexModelsByRoom["room-a"], undefined);
  assert.equal(state.projectPathDraftsByRoom["room-a"], "/tmp/example");
  assert.equal(state.customCodexModelsByRoom["room-b"], undefined);
  assert.equal(state.projectPathDraftsByRoom["room-b"], undefined);
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
  assert.equal(state.localPreviewsByRoom["room-a"]?.[0]?.status, "live");
  assert.equal(state.localPreviewBusyByRoom["room-a"], true);
  assert.equal(state.localPreviewBusyByRoom["room-b"], undefined);
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
  assert.equal(state.inviteRequestsByRoom["room-a"]?.[0]?.requester, "Jordan");
  assert.equal(state.inviteSecretInput, "multaiplayer://invite#secret");
  assert.equal(state.inviteLinksByRoom["room-a"], "https://multaiplayer.com/invite/room-a");
  assert.equal(state.inviteApprovalGatesByRoom["room-a"], true);
  assert.equal(state.inviteApprovalGatesByRoom["room-b"], undefined);
  assert.equal(state.inviteMessagesByRoom["room-a"], "Invite created");
  assert.equal(state.inviteMessagesByRoom["room-b"], undefined);
  assert.equal(state.keyRotationBusyByRoom["room-a"], true);
  assert.equal(state.inviteAdmissionsByRoom["room-a"], undefined);
  assert.equal(state.inviteAdmissionsByRoom["room-b"], "Admitted Avery");
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
  assert.equal(state.inviteLinksByRoom["room-a"], "https://multaiplayer.com/invite/room-a");
  assert.equal(state.inviteApprovalGatesByRoom["room-a"], true);
  assert.equal(state.inviteMessagesByRoom["room-a"], undefined);
  assert.equal(state.inviteLinksByRoom["room-b"], undefined);
  assert.equal(state.inviteApprovalGatesByRoom["room-b"], undefined);
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
  assert.equal(state.chatMessagesByRoom["room-a"], "Sending message");
  assert.equal(state.chatMessagesByRoom["room-b"], undefined);
  assert.equal(state.draftsByRoom["room-a"], "@Codex draft a test plan");
  assert.equal(state.draftsByRoom["room-b"], "Looks good");
  assert.equal(state.pendingAttachmentsByRoom["room-a"]?.[0]?.name, "README.md");
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
  assert.equal(state.draftsByRoom["room-a"], "@Codex summarize this");
  assert.deepEqual(state.pendingAttachmentsByRoom["room-a"]?.map((attachment) => attachment.name), ["README.md", "plan.md"]);

  store.removePendingAttachmentForRoom("room-a", "attachment-1");
  state = useAppStore.getState();
  assert.deepEqual(state.pendingAttachmentsByRoom["room-a"]?.map((attachment) => attachment.name), ["plan.md"]);

  store.clearPendingAttachmentsForRoom("room-a");
  state = useAppStore.getState();
  assert.equal(state.pendingAttachmentsByRoom["room-a"], undefined);
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
  assert.equal(state.hostMessagesByRoom["room-a"], "Host saved");
  assert.equal(state.chatMessagesByRoom["room-a"], "Message sent");
  assert.equal(state.markdownCopyFallbacksByRoom["room-a"]?.title, "Selected messages");
  assert.equal(state.secretWarningsVisibleByRoom["room-a"], true);
  assert.equal(state.historyMessagesByRoom["room-a"], "History saved");
  assert.equal(state.teamHistoryMessagesByTeam["team-a"], "Team defaults saved");
  assert.equal(state.settingsMessagesByRoom["room-a"], "Settings saved");

  store.setHostMessageForRoom("room-a", null);
  store.setChatMessageForRoom("room-a", null);
  store.setMarkdownCopyFallbackForRoom("room-a", null);
  store.setSecretWarningVisibleForRoom("room-a", false);
  store.setHistoryMessageForRoom("room-a", null);
  store.setTeamHistoryMessageForTeam("team-a", null);
  store.setSettingsMessageForRoom("room-a", null);

  state = useAppStore.getState();
  assert.equal("room-a" in state.hostMessagesByRoom, false);
  assert.equal("room-a" in state.chatMessagesByRoom, false);
  assert.equal("room-a" in state.markdownCopyFallbacksByRoom, false);
  assert.equal("room-a" in state.secretWarningsVisibleByRoom, false);
  assert.equal("room-a" in state.historyMessagesByRoom, false);
  assert.equal("team-a" in state.teamHistoryMessagesByTeam, false);
  assert.equal("room-a" in state.settingsMessagesByRoom, false);
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
    roomId: "room-a",
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
  assert.equal(state.codexEventsByRoom["room-a"]?.[0]?.turnId, "turn-1");
  assert.equal(state.approvalVisibleByRoom["room-a"], true);
  assert.equal(state.approvalVisibleByRoom["room-b"], undefined);
  assert.equal(state.pendingCodexApprovalsByRoom["room-a"]?.messages[0]?.body, "@Codex draft a plan");
  assert.equal(state.pendingCodexApprovalsByRoom["room-a"]?.summary.workspacePath, "/Users/maddiedreese/Documents/MultAIplayer");
  assert.equal(state.codexRunningByRoom["room-a"], true);
  assert.equal(state.codexRunningByRoom["room-b"], undefined);
  assert.equal(state.roomGoalsByRoom["room-a"]?.text, "Finish the room");
  assert.equal(state.secretWarningsVisibleByRoom["room-a"], true);
  assert.equal(state.codexThreadIdsByRoom["room-a"], "thread-room-a");
});

test("desktop store exposes room Codex approval actions", () => {
  const store = useAppStore.getState();
  const approval = {
    roomId: "room-a",
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

  store.setApprovalVisibleForRoom("room-a", true);
  store.setPendingCodexApprovalForRoom("room-a", approval);
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
  assert.equal(state.approvalVisibleByRoom["room-a"], undefined);
  assert.equal(state.pendingCodexApprovalsByRoom["room-a"], undefined);
  assert.equal(state.codexRunningByRoom["room-a"], undefined);
  assert.equal(state.roomGoalsByRoom["room-a"], undefined);
  assert.equal(state.approvalVisibleByRoom["room-b"], true);
});

test("desktop store exposes room Codex thread actions", () => {
  const store = useAppStore.getState();

  store.setCodexThreadIdForRoom("room-a", "thread-room-a");
  assert.equal(useAppStore.getState().codexThreadIdsByRoom["room-a"], "thread-room-a");

  store.setCodexThreadIdForRoom("room-a", null);
  assert.equal(useAppStore.getState().codexThreadIdsByRoom["room-a"], undefined);
});

test("desktop store keeps markdown message selection room scoped", () => {
  const store = useAppStore.getState();

  store.toggleSelectedMessageForRoom("room-a", "message-1");
  store.toggleSelectedMessageForRoom("room-a", "message-2");
  store.toggleSelectedMessageForRoom("room-b", "message-9");
  store.toggleSelectedMessageForRoom("room-a", "message-1");

  const state = useAppStore.getState();
  assert.deepEqual(state.selectedMessageIdsByRoom["room-a"], ["message-2"]);
  assert.deepEqual(state.selectedMessageIdsByRoom["room-b"], ["message-9"]);

  store.clearSelectedMessagesForRoom("room-a");
  assert.equal(useAppStore.getState().selectedMessageIdsByRoom["room-a"], undefined);
});

test("desktop store keeps history search messages room scoped", () => {
  const store = useAppStore.getState();

  store.replaceHistorySearchMessagesByRoom({
    "room-a": [
      {
        id: "history-message-1",
        author: "Jordan",
        role: "human",
        body: "Find the old setup note",
        time: "Yesterday"
      }
    ],
    "room-b": []
  });
  store.replaceHistorySearchMessagesByRoom({
    ...useAppStore.getState().historySearchMessagesByRoom,
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
  assert.equal(state.historySearchMessagesByRoom["room-a"]?.[0]?.body, "Find the old setup note");
  assert.equal(state.historySearchMessagesByRoom["room-b"]?.[0]?.author, "Codex");
});

test("desktop store keeps history status messages scoped", () => {
  const store = useAppStore.getState();

  store.setHistoryMessageForRoom("room-a", "Local history saved");
  store.setHistoryMessageForRoom("room-b", null);
  store.setTeamHistoryMessageForTeam("team-core", "Team defaults saved");
  store.setTeamHistoryMessageForTeam("__no-team", null);

  const state = useAppStore.getState();
  assert.equal(state.historyMessagesByRoom["room-a"], "Local history saved");
  assert.equal(state.historyMessagesByRoom["room-b"], undefined);
  assert.equal(state.teamHistoryMessagesByTeam["team-core"], "Team defaults saved");
  assert.equal(state.teamHistoryMessagesByTeam["__no-team"], undefined);
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
    attachmentNames: ["docs/plan.md"],
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
  assert.equal(state.inspectorTabsByRoom["room-a"], "files");
  assert.equal(state.inspectorTabsByRoom["room-b"], "terminal");
  assert.equal(state.presenceByRoom["room-a"], undefined);
  assert.equal(state.presenceByRoom["room-b"]?.["device-b"]?.displayName, "Jordan");
  assert.equal(state.hostHandoffsByRoom["room-a"]?.[0]?.reason, "usage_limit");
  assert.equal(state.codexContinuationByRoom["room-b"]?.acceptedBy, "Jordan");
  assert.equal(state.gitWorkflowEventsByRoom["room-a"]?.[0]?.branch, "codex/runtime-state");
  assert.equal(state.githubActionsEventsByRoom["room-b"]?.[0]?.summary.tone, "green");
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
  assert.deepEqual(state.presenceByRoom["room-a"], {});
  assert.equal(state.presenceByRoom["room-b"]?.["device-b"]?.displayName, "Jordan");

  store.clearPresenceByRoom();

  state = useAppStore.getState();
  assert.deepEqual(state.presenceByRoom, {});
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
  assert.equal(state.gitWorkflowEventsByRoom["room-a"]?.length, 1);
  assert.equal(state.githubActionsEventsByRoom["room-a"]?.length, 1);
  assert.equal(state.localPreviewsByRoom["room-a"]?.length, 1);
  assert.equal(state.localPreviewsByRoom["room-a"]?.[0]?.status, "live");
  assert.equal(state.hostHandoffsByRoom["room-a"]?.length, 1);
  assert.equal(state.inviteRequestsByRoom["room-a"]?.length, 1);
  assert.equal(state.codexEventsByRoom["room-a"]?.length, 1);
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
  assert.equal(state.hostHandoffsByRoom["room-a"]?.[0]?.status, "accepted");
  assert.equal(state.hostHandoffsByRoom["room-a"]?.[1]?.status, "available");
  assert.equal(state.codexContinuationByRoom["room-a"]?.id, latestHandoff.id);

  store.markLatestHostHandoffAcceptedForRoom("room-a");
  store.setCodexContinuationForRoom("room-a", null);

  state = useAppStore.getState();
  assert.equal(state.hostHandoffsByRoom["room-a"]?.[1]?.status, "accepted");
  assert.equal(state.codexContinuationByRoom["room-a"], undefined);
});

test("desktop store keeps terminal panel state room scoped", () => {
  const store = useAppStore.getState();

  store.initializeTerminalLinesByRoom({
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
  store.setTerminalNameForRoom("room-a", "shell");
  store.setTerminalCommandForRoom("room-a", "zsh -l");
  store.setTerminalInputForRoom("room-a", "git status");
  store.setTerminalErrorForRoom("room-a", null);
  store.setTerminalErrorForRoom("room-b", "Host approval required");

  const state = useAppStore.getState();
  assert.equal(state.terminalLinesByRoom["room-a"]?.[1], "stdout Ready");
  assert.equal(state.terminalBusyByRoom["room-a"], true);
  assert.equal(state.terminalBusyByRoom["room-b"], undefined);
  assert.equal(state.terminals[0]?.name, "shell");
  assert.equal(state.terminalRequestsByRoom["room-b"]?.[0]?.command, "npm test");
  assert.equal(state.selectedTerminalIdsByRoom["room-a"], "terminal-a");
  assert.equal(state.selectedTerminalIdsByRoom["room-b"], undefined);
  assert.deepEqual(state.terminalUiByRoom["room-a"], {
    name: "shell",
    command: "zsh -l",
    input: "git status"
  });
  assert.deepEqual(state.terminalUiByRoom["room-b"], {
    error: "Host approval required"
  });
});

test("desktop store exposes room terminal actions", () => {
  const store = useAppStore.getState();

  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setTerminalNameForRoom("room-a", "shell");
  store.setTerminalCommandForRoom("room-a", "zsh -l");
  store.setTerminalInputForRoom("room-a", "git status");
  store.setTerminalErrorForRoom("room-a", "Host approval required");
  store.appendTerminalLinesForRoom("room-a", ["one", "two"], 3);
  store.appendTerminalLinesForRoom("room-a", ["three", "four"], 3);
  store.setSelectedTerminalIdForRoom("room-b", null);
  store.setTerminalNameForRoom("room-b", "dev-server");
  store.setTerminalCommandForRoom("room-b", "npm run dev:desktop");
  store.setTerminalInputForRoom("room-a", "");
  store.setTerminalErrorForRoom("room-a", null);

  const state = useAppStore.getState();
  assert.equal(state.selectedTerminalIdsByRoom["room-a"], "terminal-a");
  assert.equal(state.selectedTerminalIdsByRoom["room-b"], undefined);
  assert.deepEqual(state.terminalUiByRoom["room-a"], {
    name: "shell",
    command: "zsh -l"
  });
  assert.equal(state.terminalUiByRoom["room-b"], undefined);
  assert.deepEqual(state.terminalLinesByRoom["room-a"], ["two", "three", "four"]);
});

test("desktop store clears local room-scoped state", () => {
  const store = useAppStore.getState();

  store.appendRoomMessage("room-a", { id: "message-a", author: "Avery", role: "human", body: "hello", time: "9:41" });
  store.appendRoomMessage("room-b", { id: "message-b", author: "Jordan", role: "human", body: "keep", time: "9:42" });
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
  store.setActionRunsForRoom("room-a", []);
  store.setActionRunsForRoom("room-b", []);
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
  store.setProjectFilesForRoom("room-a", [{ path: "README.md", size: 1 }]);
  store.setProjectFilesForRoom("room-b", []);
  store.setSelectedTerminalIdForRoom("room-a", "terminal-a");
  store.setSelectedTerminalIdForRoom("room-b", "terminal-b");
  store.replaceTerminalSnapshotsForRoom("room-a", [
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
  store.replaceTerminalSnapshotsForRoom("room-b", [
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

  store.clearRoomScopedStateForRoom("room-a");

  const state = useAppStore.getState();
  assert.deepEqual(state.messagesByRoom["room-a"], []);
  assert.deepEqual(state.terminalRequestsByRoom["room-a"], []);
  assert.deepEqual(state.browserRequestsByRoom["room-a"], []);
  assert.deepEqual(state.inviteRequestsByRoom["room-a"], []);
  assert.deepEqual(state.codexEventsByRoom["room-a"], []);
  assert.deepEqual(state.gitWorkflowEventsByRoom["room-a"], []);
  assert.deepEqual(state.githubActionsEventsByRoom["room-a"], []);
  assert.deepEqual(state.hostHandoffsByRoom["room-a"], []);
  assert.equal(state.codexThreadIdsByRoom["room-a"], undefined);
  assert.equal(state.githubActionsByRoom["room-a"], undefined);
  assert.equal(state.gitWorkflowBusyByRoom["room-a"], undefined);
  assert.equal(state.hostMessagesByRoom["room-a"], undefined);
  assert.equal(state.secretWarningsVisibleByRoom["room-a"], undefined);
  assert.equal(state.projectFilesByRoom["room-a"], undefined);
  assert.equal(state.selectedTerminalIdsByRoom["room-a"], undefined);
  assert.equal(state.terminals.some((terminal) => terminal.roomId === "room-a"), false);
  assert.equal(state.browserUrlsByRoom["room-a"], undefined);
  assert.equal(state.draftsByRoom["room-a"], undefined);
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "keep");
  assert.equal(state.codexEventsByRoom["room-b"]?.[0]?.turnId, "turn-b");
  assert.equal(state.codexThreadIdsByRoom["room-b"], "thread-b");
  assert.equal(state.terminals.some((terminal) => terminal.roomId === "room-b"), true);
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
  assert.equal(state.teamMembersByTeam["team-core"]?.[0]?.role, "owner");
  assert.deepEqual(state.teamMembersByTeam["team-labs"], []);
  assert.equal(state.teamMembersMessageByTeam["team-core"], null);
  assert.equal(state.teamMembersMessageByTeam["team-labs"], "Could not refresh members");
  assert.equal(state.teamMembersBusyByTeam["team-core"], true);
  assert.equal(state.teamMembersBusyByTeam["team-labs"], false);
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
  assert.equal(state.teamMembersByTeam["team-core"]?.[0]?.userId, "github:maddie");
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
  assert.equal(state.teamMembersByTeam["team-labs"], undefined);
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
  store.replaceTerminalSnapshotsForRoom("room-b", [
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
    codexThreadId: "thread-a"
  });

  const state = useAppStore.getState();
  assert.equal(state.messagesByRoom["room-a"]?.[0]?.body, "Restore this room.");
  assert.equal(state.messagesByRoom["room-b"]?.[0]?.body, "Keep this room alone.");
  assert.equal(state.terminalRequestsByRoom["room-a"]?.[0]?.command, "npm test");
  assert.equal(state.browserRequestsByRoom["room-a"]?.[0]?.url, "http://localhost:5173");
  assert.equal(state.inviteRequestsByRoom["room-a"]?.[0]?.requester, "Jordan");
  assert.equal(state.codexEventsByRoom["room-a"]?.[0]?.message, "Reading context");
  assert.equal(state.gitWorkflowEventsByRoom["room-a"]?.[0]?.branch, "codex/history-hydration");
  assert.equal(state.gitWorkflowMessagesByRoom["room-a"], "Opened draft PR");
  assert.equal(state.githubActionsEventsByRoom["room-a"]?.[0]?.runs[0]?.name, "Web, relay, and packages");
  assert.equal(state.githubActionsByRoom["room-a"]?.runs?.[0]?.id, 18);
  assert.equal(state.githubActionsByRoom["room-a"]?.lastChecked, "2026-07-06T00:08:00.000Z");
  assert.equal(state.githubActionsByRoom["room-a"]?.message, "CI: Checked Actions");
  assert.equal(state.localPreviewsByRoom["room-a"]?.[0]?.status, "live");
  assert.equal(state.terminals.some((terminal) => terminal.id === "terminal-a"), true);
  assert.equal(state.terminals.some((terminal) => terminal.id === "terminal-b"), true);
  assert.equal(state.selectedTerminalIdsByRoom["room-a"], "terminal-a");
  assert.equal(state.selectedTerminalIdsByRoom["room-b"], "terminal-b");
  assert.equal(state.hostHandoffsByRoom["room-a"]?.[0]?.reason, "usage_limit");
  assert.equal(state.codexThreadIdsByRoom["room-a"], "thread-a");
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
  assert.equal(state.teamMembersByTeam["team-core"]?.[0]?.role, "owner");
  assert.equal(state.teamMembersMessageByTeam["team-core"], "Members refreshed");
  assert.equal(state.teamMembersBusyByTeam["team-core"], true);
  assert.equal(state.teamMembersByTeam["team-labs"]?.length, 1);
  assert.equal(state.teamMembersByTeam["team-labs"]?.[0]?.role, "admin");
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

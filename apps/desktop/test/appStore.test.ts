import assert from "node:assert/strict";
import { test } from "node:test";
import { useAppStore } from "../src/store/appStore";

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("desktop store keeps git workflow state room scoped", () => {
  const store = useAppStore.getState();

  store.setGitWorkflowBusyByRoom({ "room-a": true });
  store.setGitWorkflowMessagesByRoom({ "room-a": "Creating PR", "room-b": null });
  store.setGitStatusByRoom({
    "room-a": {
      branch: "main",
      files: [{ path: "apps/desktop/src/App.tsx", status: "modified", added: 2, removed: 1 }]
    }
  });
  store.setGitWorkflowDraftsByRoom((current) => ({
    ...current,
    "room-b": { branchName: "multaiplayer/alpha" }
  }));

  const state = useAppStore.getState();
  assert.equal(state.gitWorkflowBusyByRoom["room-a"], true);
  assert.equal(state.gitWorkflowMessagesByRoom["room-a"], "Creating PR");
  assert.equal(state.gitWorkflowMessagesByRoom["room-b"], null);
  assert.equal(state.gitStatusByRoom["room-a"]?.files[0]?.path, "apps/desktop/src/App.tsx");
  assert.deepEqual(state.gitWorkflowDraftsByRoom["room-b"], { branchName: "multaiplayer/alpha" });
});

test("desktop store keeps GitHub Actions state room scoped", () => {
  const store = useAppStore.getState();

  store.setActionsBusyByRoom({ "room-a": true });
  store.setActionsMessagesByRoom({ "room-a": "Refreshing Actions", "room-b": null });
  store.setActionRunsByRoom({
    "room-a": [
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
  store.setActionsLastCheckedByRoom((current) => ({
    ...current,
    "room-a": "2026-07-06T00:02:00.000Z"
  }));

  const state = useAppStore.getState();
  assert.equal(state.actionsBusyByRoom["room-a"], true);
  assert.equal(state.actionsMessagesByRoom["room-a"], "Refreshing Actions");
  assert.equal(state.actionsMessagesByRoom["room-b"], null);
  assert.equal(state.actionRunsByRoom["room-a"]?.[0]?.name, "CI");
  assert.equal(state.actionsLastCheckedByRoom["room-a"], "2026-07-06T00:02:00.000Z");
});

test("desktop store keeps browser panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setBrowserRequestsByRoom({
    "room-a": [
      {
        id: "browser-request-1",
        requester: "Avery",
        requesterUserId: "github:avery",
        url: "http://localhost:3000",
        reason: "Inspect local preview",
        requestedAt: "2026-07-06T00:03:00.000Z",
        status: "pending"
      }
    ]
  });
  store.setBrowserUrlsByRoom({ "room-a": "https://github.com", "room-b": "http://localhost:5173" });
  store.setBrowserReasonsByRoom((current) => ({
    ...current,
    "room-b": "Open app preview"
  }));
  store.setBrowserMessagesByRoom({ "room-a": "Opened browser", "room-b": null });
  store.setBrowserStatusByRoom({
    "room-a": {
      profilePath: "/Users/maddiedreese/Library/Application Support/multAIplayer/browser/room-a",
      downloadsBlocked: true,
      clipboardBlocked: true,
      fileUploadsBlocked: true
    }
  });
  store.setActiveBrowserUrlsByRoom({ "room-a": "https://github.com", "room-b": null });

  const state = useAppStore.getState();
  assert.equal(state.browserRequestsByRoom["room-a"]?.[0]?.url, "http://localhost:3000");
  assert.equal(state.browserUrlsByRoom["room-b"], "http://localhost:5173");
  assert.equal(state.browserReasonsByRoom["room-b"], "Open app preview");
  assert.equal(state.browserMessagesByRoom["room-a"], "Opened browser");
  assert.equal(state.browserMessagesByRoom["room-b"], null);
  assert.equal(state.browserStatusByRoom["room-a"]?.downloadsBlocked, true);
  assert.equal(state.activeBrowserUrlsByRoom["room-a"], "https://github.com");
  assert.equal(state.activeBrowserUrlsByRoom["room-b"], null);
});

test("desktop store keeps file panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setFileQueriesByRoom({ "room-a": "README", "room-b": ".env" });
  store.setProjectFilesByRoom({
    "room-a": [
      { path: "README.md", size: 2048 },
      { path: "apps/desktop/src/App.tsx", size: 4096 }
    ]
  });
  store.setSelectedFilesByRoom({
    "room-a": {
      path: "README.md",
      size: 2048,
      truncated: false,
      content: "# multAIplayer"
    },
    "room-b": null
  });
  store.setSelectedDiffsByRoom({
    "room-a": {
      path: "README.md",
      diff: "@@ -1 +1 @@\n-old\n+new"
    }
  });
  store.setFilePreviewTabsByRoom({ "room-a": "diff" });
  store.setFileBusyByRoom({ "room-a": true });
  store.setFileMessagesByRoom({ "room-a": "Loaded README.md", "room-b": null });
  store.setMarkdownCopyFallbacksByRoom({
    "room-a": {
      title: "README.md",
      markdown: "# multAIplayer"
    }
  });

  const state = useAppStore.getState();
  assert.equal(state.fileQueriesByRoom["room-b"], ".env");
  assert.equal(state.projectFilesByRoom["room-a"]?.[1]?.path, "apps/desktop/src/App.tsx");
  assert.equal(state.selectedFilesByRoom["room-a"]?.content, "# multAIplayer");
  assert.equal(state.selectedFilesByRoom["room-b"], null);
  assert.equal(state.selectedDiffsByRoom["room-a"]?.path, "README.md");
  assert.equal(state.filePreviewTabsByRoom["room-a"], "diff");
  assert.equal(state.fileBusyByRoom["room-a"], true);
  assert.equal(state.fileMessagesByRoom["room-a"], "Loaded README.md");
  assert.equal(state.fileMessagesByRoom["room-b"], null);
  assert.equal(state.markdownCopyFallbacksByRoom["room-a"]?.title, "README.md");
});

test("desktop store keeps room settings state room scoped", () => {
  const store = useAppStore.getState();

  store.setHostBusyByRoom({ "room-a": true });
  store.setHostMessagesByRoom({ "room-a": "Host updated", "room-b": null });
  store.setSettingsBusyByRoom({ "room-b": true });
  store.setSettingsMessagesByRoom((current) => ({
    ...current,
    "room-a": "Settings saved"
  }));
  store.setCustomCodexModelsByRoom({ "room-a": "gpt-5.4", "room-b": "o4-mini" });
  store.setProjectPathDraftsByRoom({
    "room-a": "/Users/maddiedreese/Documents/MultAIplayer",
    "room-b": "/tmp/example"
  });

  const state = useAppStore.getState();
  assert.equal(state.hostBusyByRoom["room-a"], true);
  assert.equal(state.hostMessagesByRoom["room-a"], "Host updated");
  assert.equal(state.hostMessagesByRoom["room-b"], null);
  assert.equal(state.settingsBusyByRoom["room-b"], true);
  assert.equal(state.settingsMessagesByRoom["room-a"], "Settings saved");
  assert.equal(state.customCodexModelsByRoom["room-a"], "gpt-5.4");
  assert.equal(state.projectPathDraftsByRoom["room-b"], "/tmp/example");
});

test("desktop store keeps local preview state room scoped", () => {
  const store = useAppStore.getState();

  store.setLocalPreviewsByRoom({
    "room-a": [
      {
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
      }
    ]
  });
  store.setLocalPreviewBusyByRoom({ "room-a": true, "room-b": false });
  store.setLocalPreviewDialog({
    open: true,
    phase: "confirm",
    roomId: "room-a",
    candidates: [{ url: "http://localhost:5173/", label: "localhost:5173" }],
    selectedUrl: "http://localhost:5173/",
    manualUrl: "",
    error: null,
    cloudflaredVersion: "2026.7.0"
  });

  const state = useAppStore.getState();
  assert.equal(state.localPreviewsByRoom["room-a"]?.[0]?.status, "live");
  assert.equal(state.localPreviewBusyByRoom["room-a"], true);
  assert.equal(state.localPreviewBusyByRoom["room-b"], false);
  assert.equal(state.localPreviewDialog.open, true);
  assert.equal(state.localPreviewDialog.candidates[0]?.label, "localhost:5173");
});

test("desktop store keeps invite panel state room scoped", () => {
  const store = useAppStore.getState();

  store.setInviteRequestsByRoom({
    "room-a": [
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
    ]
  });
  store.setInviteSecretInput("multaiplayer://invite#secret");
  store.setInviteLinksByRoom({ "room-a": "https://multaiplayer.com/invite/room-a" });
  store.setInviteApprovalGatesByRoom({ "room-a": true, "room-b": false });
  store.setInviteMessagesByRoom({ "room-a": "Invite created", "room-b": null });
  store.setKeyRotationBusyByRoom({ "room-a": true });
  store.setInviteAdmissionsByRoom({ "room-a": "Admitted Jordan" });

  const state = useAppStore.getState();
  assert.equal(state.inviteRequestsByRoom["room-a"]?.[0]?.requester, "Jordan");
  assert.equal(state.inviteSecretInput, "multaiplayer://invite#secret");
  assert.equal(state.inviteLinksByRoom["room-a"], "https://multaiplayer.com/invite/room-a");
  assert.equal(state.inviteApprovalGatesByRoom["room-a"], true);
  assert.equal(state.inviteApprovalGatesByRoom["room-b"], false);
  assert.equal(state.inviteMessagesByRoom["room-a"], "Invite created");
  assert.equal(state.inviteMessagesByRoom["room-b"], null);
  assert.equal(state.keyRotationBusyByRoom["room-a"], true);
  assert.equal(state.inviteAdmissionsByRoom["room-a"], "Admitted Jordan");
});

test("desktop store keeps room chat composition state room scoped", () => {
  const store = useAppStore.getState();

  store.setChatMessagesByRoom({ "room-a": "Sending message", "room-b": null });
  store.setDraftsByRoom({ "room-a": "@Codex draft a test plan", "room-b": "Looks good" });
  store.setPendingAttachmentsByRoom((current) => ({
    ...current,
    "room-a": [
      {
        id: "attachment-1",
        name: "README.md",
        type: "text/markdown",
        size: 18,
        content: "# multAIplayer"
      }
    ]
  }));
  store.setSensitiveAttachmentReviewKey("room-a:.env");

  const state = useAppStore.getState();
  assert.equal(state.chatMessagesByRoom["room-a"], "Sending message");
  assert.equal(state.chatMessagesByRoom["room-b"], null);
  assert.equal(state.draftsByRoom["room-a"], "@Codex draft a test plan");
  assert.equal(state.draftsByRoom["room-b"], "Looks good");
  assert.equal(state.pendingAttachmentsByRoom["room-a"]?.[0]?.name, "README.md");
  assert.equal(state.sensitiveAttachmentReviewKey, "room-a:.env");
});

test("desktop store keeps Codex room state room scoped", () => {
  const store = useAppStore.getState();

  store.setCodexEventsByRoom({
    "room-a": [
      {
        eventType: "codex.turn",
        turnId: "turn-1",
        status: "started",
        message: "Reading room context",
        model: "gpt-5.4",
        threadId: "thread-room-a",
        host: "Maddie",
        hostUserId: "github:maddie",
        createdAt: "2026-07-06T00:07:00.000Z"
      }
    ]
  });
  store.setApprovalVisibleByRoom({ "room-a": true, "room-b": false });
  store.setPendingCodexApprovalsByRoom({
    "room-a": {
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
    }
  });
  store.setCodexRunningByRoom({ "room-a": true, "room-b": false });
  store.setSecretWarningsVisibleByRoom({ "room-a": true });
  store.setCodexThreadIdsByRoom((current) => ({
    ...current,
    "room-a": "thread-room-a"
  }));

  const state = useAppStore.getState();
  assert.equal(state.codexEventsByRoom["room-a"]?.[0]?.turnId, "turn-1");
  assert.equal(state.approvalVisibleByRoom["room-a"], true);
  assert.equal(state.approvalVisibleByRoom["room-b"], false);
  assert.equal(state.pendingCodexApprovalsByRoom["room-a"]?.messages[0]?.body, "@Codex draft a plan");
  assert.equal(state.pendingCodexApprovalsByRoom["room-a"]?.summary.workspacePath, "/Users/maddiedreese/Documents/MultAIplayer");
  assert.equal(state.codexRunningByRoom["room-a"], true);
  assert.equal(state.codexRunningByRoom["room-b"], false);
  assert.equal(state.secretWarningsVisibleByRoom["room-a"], true);
  assert.equal(state.codexThreadIdsByRoom["room-a"], "thread-room-a");
});

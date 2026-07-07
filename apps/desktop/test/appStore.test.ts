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

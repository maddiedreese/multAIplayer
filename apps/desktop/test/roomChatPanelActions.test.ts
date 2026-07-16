import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { createRoomChatPanelActions } from "../src/application/chat/roomChatPanelActions";
import { createRoomHeaderActions } from "../src/application/rooms/roomHeaderActions";
import { createTerminalPanelActions } from "../src/application/terminal/terminalPanelActions";
import { createWorkspaceFilesPanelActions } from "../src/application/files/workspaceFilesPanelActions";
import { useAppStore } from "../src/store/appStore";

const room: ClientRoomRecord = {
  id: "room-preview",
  teamId: "team-alpha",
  name: "Preview",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  browserProfilePersistent: true,
  unread: 0
};

const noop = () => undefined;
const noopAsync = async () => undefined;

test("local preview actions resolve the selected room when invoked", () => {
  const opened: Array<{ room: ClientRoomRecord; url: string; reason: string }> = [];
  const preview = {
    eventType: "local.preview" as const,
    id: "preview-1",
    sharedBy: "Maddie",
    sharedByUserId: "github:maddiedreese",
    sourceUrl: "http://localhost:5173/",
    publicUrl: "https://example.trycloudflare.com",
    status: "live" as const,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:01:00.000Z"
  };
  const store = useAppStore.getState();
  store.resetAppStore();
  useAppStore.setState({ rooms: [room], selectedRoomId: room.id });
  store.appendLocalPreviewEvent(room.id, preview);
  const actions = createRoomChatPanelActions({
    copyMessageMarkdown: noop,
    copyCodexOutputMarkdown: noop,
    openEncryptedAttachmentBlob: noop,
    toggleMessageReaction: noop,
    publishChatMessageEdit: noopAsync,
    publishChatMessageDelete: noopAsync,
    publishChatMessage: noopAsync,
    promoteNextCodexApprovalForRoom: noop,
    approveCodexTurn: noop,
    handleCodexInvoke: noop,
    publishCodexQueueEvent: noopAsync,
    pauseGoal: noop,
    resumeGoal: noop,
    editGoal: noop,
    deleteGoal: noop,
    tickGoalElapsed: noop,
    copyMarkdownWithFallback: noopAsync,
    stopLocalPreview: noopAsync,
    openBrowserUrl: (targetRoom, url, reason) => opened.push({ room: targetRoom, url, reason })
  });

  const nextRoom = { ...room, id: "room-preview-next", name: "Next Preview" };
  store.replaceRooms([room, nextRoom]);
  store.setSelectedRoomId(nextRoom.id);
  store.appendLocalPreviewEvent(nextRoom.id, preview);

  actions.onOpenLocalPreview("preview-1");

  assert.deepEqual(opened, [
    {
      room: nextRoom,
      url: "https://example.trycloudflare.com",
      reason: "Opened from a shared local preview."
    }
  ]);
});

test("room header actions mutate the store without a React subscription", () => {
  const store = useAppStore.getState();
  store.resetAppStore();
  useAppStore.setState({ rooms: [room], selectedRoomId: room.id });
  let browserOpenCount = 0;
  const actions = createRoomHeaderActions({
    selectedRoomId: "room-fallback",
    selectedRoomIdForTabs: room.id,
    activeBrowserUrl: null,
    selectTeamRoom: noop,
    openRoomBrowserNow: () => {
      browserOpenCount += 1;
    }
  });

  actions.onSelectInspectorTab("browser");

  assert.equal(useAppStore.getState().historyPresenceByRoom[room.id]?.inspectorTab, "browser");
  assert.equal(browserOpenCount, 1);
  useAppStore.getState().resetAppStore();
});

test("terminal panel actions resolve request ids before approval", () => {
  const store = useAppStore.getState();
  store.resetAppStore();
  useAppStore.setState({ rooms: [room], selectedRoomId: room.id });
  store.appendTerminalRequest(room.id, {
    id: "request-1",
    roomId: room.id,
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    command: "npm test",
    status: "pending",
    createdAt: "2026-07-09T12:00:00.000Z"
  });
  const approved: string[] = [];
  let revokeCount = 0;
  const actions = createTerminalPanelActions({
    selectedRoomId: room.id,
    terminalRequests: [
      {
        id: "request-1",
        roomId: room.id,
        requestedBy: "Avery",
        requestedByUserId: "github:avery",
        command: "npm test",
        status: "pending",
        createdAt: "2026-07-09T12:00:00.000Z"
      }
    ],
    copyTerminalMarkdown: noop,
    openInteractiveTerminal: noop,
    approveTerminalRequest: (request) => approved.push(request.id),
    denyTerminalRequest: noop,
    sendTerminalData: noop,
    restartSelectedTerminal: noop,
    stopSelectedTerminal: noop,
    revokeExactCommandGrants: () => {
      revokeCount += 1;
    }
  });

  actions.onApproveTerminalRequest("missing");
  actions.onApproveTerminalRequest("request-1");
  actions.onRevokeExactCommandGrants();

  assert.deepEqual(approved, ["request-1"]);
  assert.equal(revokeCount, 1);
});

test("workspace file panel close clears all viewer state", () => {
  useAppStore.getState().resetAppStore();
  useAppStore.setState({ rooms: [room], selectedRoomId: room.id });
  useAppStore.getState().setSelectedFileForRoom(room.id, {
    path: "src/main.ts",
    content: "export {};",
    truncated: false
  });
  useAppStore.getState().setSelectedDiffForRoom(room.id, {
    path: "src/main.ts",
    diff: "diff --git a/src/main.ts b/src/main.ts",
    truncated: false
  });
  useAppStore.getState().setSensitiveAttachmentReviewKey("review-key");
  const actions = createWorkspaceFilesPanelActions({
    selectedRoomId: room.id,
    copyProjectMarkdown: noop,
    setFileQueryForRoom: noop,
    openProjectFile: noop,
    copyDiffSummaryMarkdown: noop,
    attachSelectedFileToMessage: noop,
    saveSelectedFileContent: noop,
    approveFileSaveRequest: noop,
    denyFileSaveRequest: noop
  });

  actions.onCloseFileViewer();

  const store = useAppStore.getState();
  assert.equal(store.filePanelByRoom[room.id]?.selectedFile, undefined);
  assert.equal(store.filePanelByRoom[room.id]?.selectedDiff, undefined);
  assert.equal(store.sensitiveAttachmentReviewKey, null);
  store.resetAppStore();
});

import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { useRoomChatPanelActions } from "../src/hooks/useRoomChatPanelActions";

const room: RoomRecord = {
  id: "room-preview",
  teamId: "team-alpha",
  name: "Preview",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
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

const noop = () => undefined;
const noopAsync = async () => undefined;

test("local preview open action opens the Cloudflare URL in the room browser", () => {
  const opened: Array<{ room: RoomRecord; url: string; reason: string }> = [];
  const actions = useRoomChatPanelActions({
    selectedRoomId: room.id,
    messages: [],
    localPreviews: [
      {
        eventType: "local.preview",
        id: "preview-1",
        sharedBy: "Maddie",
        sharedByUserId: "github:maddiedreese",
        sourceUrl: "http://localhost:5173/",
        publicUrl: "https://example.trycloudflare.com",
        status: "live",
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:01:00.000Z"
      }
    ],
    copyMessageMarkdown: noop,
    copyCodexOutputMarkdown: noop,
    openEncryptedAttachmentBlob: noop,
    toggleMessageReaction: noop,
    publishChatMessageEdit: noopAsync,
    publishChatMessageDelete: noopAsync,
    publishChatMessage: noopAsync,
    setPendingCodexApprovalForRoom: noop,
    setApprovalVisibleForRoom: noop,
    removeQueuedCodexApprovalForRoom: noop,
    promoteNextCodexApprovalForRoom: noop,
    approveCodexTurn: noop,
    handleCodexInvoke: noop,
    activeCodexApproval: null,
    publishCodexQueueEvent: noopAsync,
    selectedRoom: room,
    pauseGoal: noop,
    resumeGoal: noop,
    editGoal: noop,
    deleteGoal: noop,
    tickGoalElapsed: noop,
    copyMarkdownWithFallback: noopAsync,
    setChatMessageForRoom: noop,
    stopLocalPreview: noopAsync,
    openBrowserUrl: (targetRoom, url, reason) => opened.push({ room: targetRoom, url, reason }),
    setInspectorTabForRoom: noop,
    setReplyToMessageForRoom: noop,
    setDraftForRoom: noop
  });

  actions.onOpenLocalPreview("preview-1");

  assert.deepEqual(opened, [
    {
      room,
      url: "https://example.trycloudflare.com",
      reason: "Opened from a shared local preview."
    }
  ]);
});

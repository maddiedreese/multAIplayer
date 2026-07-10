import type { RoomRecord } from "@multaiplayer/protocol";
import type { ChatAttachment, ChatMessage } from "../types";
import { formatMessageTime } from "./appFormatters";
import { useAppStore } from "../store/appStore";
import { currentSelectedRoom } from "./selectedWorkspace";

export function createRoomChatPanelActions({
  copyMessageMarkdown,
  copyCodexOutputMarkdown,
  openEncryptedAttachmentBlob,
  toggleMessageReaction,
  publishChatMessageEdit,
  publishChatMessageDelete,
  publishChatMessage,
  promoteNextCodexApprovalForRoom,
  approveCodexTurn,
  handleCodexInvoke,
  publishCodexQueueEvent,
  pauseGoal,
  resumeGoal,
  editGoal,
  deleteGoal,
  tickGoalElapsed,
  copyMarkdownWithFallback,
  stopLocalPreview,
  openBrowserUrl
}: {
  copyMessageMarkdown: (message: ChatMessage) => void;
  copyCodexOutputMarkdown: (message: ChatMessage) => void;
  openEncryptedAttachmentBlob: (attachment: ChatAttachment) => void;
  toggleMessageReaction: (message: ChatMessage, emoji: string) => void;
  publishChatMessageEdit: (message: ChatMessage, body: string) => Promise<void>;
  publishChatMessageDelete: (message: ChatMessage) => Promise<void>;
  publishChatMessage: (message: ChatMessage) => Promise<void>;
  promoteNextCodexApprovalForRoom: (roomId: string) => void;
  approveCodexTurn: () => void;
  handleCodexInvoke: () => void;
  publishCodexQueueEvent: (
    event: {
      turnId: string;
      action: "queued" | "cancelled" | "coalesced" | "promoted" | "dropped";
      triggerMessageId?: string;
      reason?: string;
      queueSize: number;
    },
    room?: RoomRecord
  ) => Promise<void>;
  pauseGoal: () => void;
  resumeGoal: () => void;
  editGoal: (text: string) => void;
  deleteGoal: () => void;
  tickGoalElapsed: () => void;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setMessage: (message: string) => void,
    roomId: string
  ) => Promise<void>;
  stopLocalPreview: (previewId: string) => Promise<void>;
  openBrowserUrl: (room: RoomRecord, url: string, reason: string) => void;
}) {
  const selectedRoomId = () => useAppStore.getState().selectedRoomId;
  const selectedRoomMessages = () => useAppStore.getState().messagesByRoom[selectedRoomId()] ?? [];
  const selectedRoomPreviews = () => useAppStore.getState().localPreviewByRoom[selectedRoomId()]?.previews ?? [];

  function onCopyMessageMarkdown(messageId: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    if (message) copyMessageMarkdown(message);
  }

  function onCopyCodexOutputMarkdown(messageId: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    if (message) copyCodexOutputMarkdown(message);
  }

  function onOpenAttachment(messageId: string, attachmentId: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    const attachment = message?.attachments?.find((item) => item.id === attachmentId);
    if (attachment) openEncryptedAttachmentBlob(attachment);
  }

  function onToggleReaction(messageId: string, emoji: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    if (message) toggleMessageReaction(message, emoji);
  }

  function onEditMessage(messageId: string, nextBody: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    if (message) void publishChatMessageEdit(message, nextBody);
  }

  function onDeleteMessage(messageId: string) {
    const message = selectedRoomMessages().find((item) => item.id === messageId);
    if (message) void publishChatMessageDelete(message);
  }

  function onDenyApproval() {
    const roomId = selectedRoomId();
    const selectedRoom = currentSelectedRoom();
    const deniedTurn = useAppStore.getState().codexRuntimeByRoom[roomId]?.pendingApproval ?? null;
    const store = useAppStore.getState();
    store.setPendingCodexApprovalForRoom(roomId, null);
    store.setApprovalVisibleForRoom(roomId, false);
    if (deniedTurn) {
      store.removeQueuedCodexApprovalForRoom(roomId, deniedTurn.turnId);
      void publishCodexQueueEvent(
        {
          turnId: deniedTurn.turnId,
          action: "dropped",
          reason: `${deniedTurn.requestedBy}'s Codex proposal was declined by the active host.`,
          queueSize: 0
        },
        selectedRoom
      );
    }
    promoteNextCodexApprovalForRoom(roomId);
  }

  function onOpenLocalPreview(previewId: string) {
    const preview = selectedRoomPreviews().find((item) => item.id === previewId);
    const selectedRoom = currentSelectedRoom();
    if (preview?.publicUrl && selectedRoom)
      openBrowserUrl(selectedRoom, preview.publicUrl, "Opened from a shared local preview.");
  }

  function onCopyLocalPreviewLink(previewId: string) {
    const preview = selectedRoomPreviews().find((item) => item.id === previewId);
    if (preview?.publicUrl) {
      void copyMarkdownWithFallback(
        "local preview link",
        preview.publicUrl,
        (message) => useAppStore.getState().setChatMessageForRoom(selectedRoomId(), message),
        selectedRoomId()
      );
    }
  }

  return {
    onCopyMessageMarkdown,
    onCopyCodexOutputMarkdown,
    onOpenAttachment,
    onToggleReaction,
    onEditMessage,
    onDeleteMessage,
    onDenyApproval,
    onApproveApproval: () => approveCodexTurn(),
    onInvokeCodex: () => handleCodexInvoke(),
    onPauseGoal: pauseGoal,
    onResumeGoal: resumeGoal,
    onEditGoal: editGoal,
    onDeleteGoal: deleteGoal,
    onTickGoalElapsed: tickGoalElapsed,
    onOpenLocalPreview,
    onCopyLocalPreviewLink,
    onStopLocalPreview: (previewId: string) => void stopLocalPreview(previewId),
    onOpenFileSelector: () => useAppStore.getState().setInspectorTabForRoom(selectedRoomId(), "files"),
    onReplyToMessage: (messageId: string) =>
      useAppStore.getState().setReplyToMessageForRoom(selectedRoomId(), messageId),
    onCancelReply: () => useAppStore.getState().setReplyToMessageForRoom(selectedRoomId(), null),
    onCancelQueuedCodexTurn: (turnId: string) => {
      const roomId = selectedRoomId();
      const selectedRoom = currentSelectedRoom();
      useAppStore.getState().removeQueuedCodexApprovalForRoom(roomId, turnId);
      void publishCodexQueueEvent(
        {
          turnId,
          action: "cancelled",
          reason: "Queued Codex turn cancelled.",
          queueSize: 0
        },
        selectedRoom
      );
      void publishChatMessage({
        id: crypto.randomUUID(),
        author: "multAIplayer",
        role: "system",
        body: "Queued Codex turn cancelled.",
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      });
    },
    onDraftChange: (nextDraft: string) => useAppStore.getState().setDraftForRoom(selectedRoomId(), nextDraft)
  };
}

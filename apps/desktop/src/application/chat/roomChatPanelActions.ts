import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { ChatAttachment, ChatMessage } from "../../types";
import { formatMessageTime } from "../../lib/formatting/appFormatters";
import { useAppStore } from "../../store/appStore";
import { currentSelectedRoom } from "../workspace/selectedWorkspace";

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
    room?: ClientRoomRecord
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
  openBrowserUrl: (room: ClientRoomRecord, url: string, reason: string) => void;
}) {
  const selectedRoomId = () => useAppStore.getState().selectedRoomId;
  const selectedRoomMessages = () => {
    const roomId = selectedRoomId();
    return roomId ? (useAppStore.getState().messagesByRoom[roomId] ?? []) : [];
  };
  const selectedRoomPreviews = () => {
    const roomId = selectedRoomId();
    return roomId ? (useAppStore.getState().localPreviewByRoom[roomId]?.previews ?? []) : [];
  };

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
    if (!roomId) return;
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
      const roomId = selectedRoomId();
      if (!roomId) return;
      void copyMarkdownWithFallback(
        "local preview link",
        preview.publicUrl,
        (message) => useAppStore.getState().setChatMessageForRoom(roomId, message),
        roomId
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
    onOpenFileSelector: () => {
      const roomId = selectedRoomId();
      if (roomId) useAppStore.getState().setInspectorTabForRoom(roomId, "files");
    },
    onReplyToMessage: (messageId: string) => {
      const roomId = selectedRoomId();
      if (roomId) useAppStore.getState().setReplyToMessageForRoom(roomId, messageId);
    },
    onCancelReply: () => {
      const roomId = selectedRoomId();
      if (roomId) useAppStore.getState().setReplyToMessageForRoom(roomId, null);
    },
    onCancelQueuedCodexTurn: (turnId: string) => {
      const roomId = selectedRoomId();
      if (!roomId) return;
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
    onDraftChange: (nextDraft: string) => {
      const roomId = selectedRoomId();
      if (roomId) useAppStore.getState().setDraftForRoom(roomId, nextDraft);
    }
  };
}

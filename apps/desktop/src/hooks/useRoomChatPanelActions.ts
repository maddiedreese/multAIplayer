import type { RoomRecord } from "@multaiplayer/protocol";
import type { ChatAttachment, ChatMessage, LocalPreviewRecord, PendingCodexApproval } from "../types";
import { formatMessageTime } from "../lib/appFormatters";

export function useRoomChatPanelActions({
  selectedRoomId,
  messages,
  localPreviews,
  copyMessageMarkdown,
  copyCodexOutputMarkdown,
  openEncryptedAttachmentBlob,
  toggleMessageReaction,
  publishChatMessageEdit,
  publishChatMessageDelete,
  publishChatMessage,
  setPendingCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  removeQueuedCodexApprovalForRoom,
  promoteNextCodexApprovalForRoom,
  approveCodexTurn,
  handleCodexInvoke,
  activeCodexApproval,
  publishCodexQueueEvent,
  selectedRoom,
  pauseGoal,
  resumeGoal,
  editGoal,
  deleteGoal,
  tickGoalElapsed,
  copyMarkdownWithFallback,
  setChatMessageForRoom,
  stopLocalPreview,
  openBrowserUrl,
  setInspectorTabForRoom,
  setReplyToMessageForRoom,
  setDraftForRoom
}: {
  selectedRoomId: string;
  messages: ChatMessage[];
  localPreviews: LocalPreviewRecord[];
  copyMessageMarkdown: (message: ChatMessage) => void;
  copyCodexOutputMarkdown: (message: ChatMessage) => void;
  openEncryptedAttachmentBlob: (attachment: ChatAttachment) => void;
  toggleMessageReaction: (message: ChatMessage, emoji: string) => void;
  publishChatMessageEdit: (message: ChatMessage, body: string) => Promise<void>;
  publishChatMessageDelete: (message: ChatMessage) => Promise<void>;
  publishChatMessage: (message: ChatMessage) => Promise<void>;
  setPendingCodexApprovalForRoom: (roomId: string, approval: null) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  removeQueuedCodexApprovalForRoom: (roomId: string, turnId: string) => void;
  promoteNextCodexApprovalForRoom: (roomId: string) => void;
  approveCodexTurn: () => void;
  handleCodexInvoke: () => void;
  activeCodexApproval: PendingCodexApproval | null;
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
  selectedRoom: RoomRecord;
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
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  stopLocalPreview: (previewId: string) => Promise<void>;
  openBrowserUrl: (room: RoomRecord, url: string, reason: string) => void;
  setInspectorTabForRoom: (roomId: string, tab: "files" | "terminal" | "browser" | "room") => void;
  setReplyToMessageForRoom: (roomId: string, messageId: string | null) => void;
  setDraftForRoom: (roomId: string, draft: string) => void;
}) {
  function onCopyMessageMarkdown(messageId: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message) copyMessageMarkdown(message);
  }

  function onCopyCodexOutputMarkdown(messageId: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message) copyCodexOutputMarkdown(message);
  }

  function onOpenAttachment(messageId: string, attachmentId: string) {
    const message = messages.find((item) => item.id === messageId);
    const attachment = message?.attachments?.find((item) => item.id === attachmentId);
    if (attachment) openEncryptedAttachmentBlob(attachment);
  }

  function onToggleReaction(messageId: string, emoji: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message) toggleMessageReaction(message, emoji);
  }

  function onEditMessage(messageId: string, nextBody: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message) void publishChatMessageEdit(message, nextBody);
  }

  function onDeleteMessage(messageId: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message) void publishChatMessageDelete(message);
  }

  function onDenyApproval() {
    const deniedTurn = activeCodexApproval;
    setPendingCodexApprovalForRoom(selectedRoomId, null);
    setApprovalVisibleForRoom(selectedRoomId, false);
    if (deniedTurn) {
      removeQueuedCodexApprovalForRoom(selectedRoomId, deniedTurn.turnId);
      void publishCodexQueueEvent({
        turnId: deniedTurn.turnId,
        action: "dropped",
        reason: `${deniedTurn.requestedBy}'s Codex proposal was declined by the active host.`,
        queueSize: 0
      }, selectedRoom);
    }
    promoteNextCodexApprovalForRoom(selectedRoomId);
  }

  function onOpenLocalPreview(previewId: string) {
    const preview = localPreviews.find((item) => item.id === previewId);
    if (preview?.publicUrl) openBrowserUrl(selectedRoom, preview.publicUrl, "Opened from a shared local preview.");
  }

  function onCopyLocalPreviewLink(previewId: string) {
    const preview = localPreviews.find((item) => item.id === previewId);
    if (preview?.publicUrl) {
      void copyMarkdownWithFallback(
        "local preview link",
        preview.publicUrl,
        (message) => setChatMessageForRoom(selectedRoomId, message),
        selectedRoomId
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
    onOpenFileSelector: () => setInspectorTabForRoom(selectedRoomId, "files"),
    onReplyToMessage: (messageId: string) => setReplyToMessageForRoom(selectedRoomId, messageId),
    onCancelReply: () => setReplyToMessageForRoom(selectedRoomId, null),
    onCancelQueuedCodexTurn: (turnId: string) => {
      removeQueuedCodexApprovalForRoom(selectedRoomId, turnId);
      void publishCodexQueueEvent({
        turnId,
        action: "cancelled",
        reason: "Queued Codex turn cancelled.",
        queueSize: 0
      }, selectedRoom);
      void publishChatMessage({
        id: crypto.randomUUID(),
        author: "multAIplayer",
        role: "system",
        body: "Queued Codex turn cancelled.",
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      });
    },
    onDraftChange: (nextDraft: string) => setDraftForRoom(selectedRoomId, nextDraft)
  };
}

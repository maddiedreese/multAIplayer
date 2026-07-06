import type { ChatAttachment, ChatMessage, LocalPreviewRecord } from "../types";

export function useRoomChatPanelActions({
  selectedRoomId,
  messages,
  localPreviews,
  copyMessageMarkdown,
  copyCodexOutputMarkdown,
  openEncryptedAttachmentBlob,
  toggleMessageReaction,
  setPendingCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  approveCodexTurn,
  handleCodexInvoke,
  copyMarkdownWithFallback,
  setChatMessageForRoom,
  stopLocalPreview,
  setDraftForRoom
}: {
  selectedRoomId: string;
  messages: ChatMessage[];
  localPreviews: LocalPreviewRecord[];
  copyMessageMarkdown: (message: ChatMessage) => void;
  copyCodexOutputMarkdown: (message: ChatMessage) => void;
  openEncryptedAttachmentBlob: (attachment: ChatAttachment) => void;
  toggleMessageReaction: (message: ChatMessage, emoji: string) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: null) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  approveCodexTurn: () => void;
  handleCodexInvoke: () => void;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setMessage: (message: string) => void,
    roomId: string
  ) => Promise<void>;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  stopLocalPreview: (previewId: string) => Promise<void>;
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

  function onDenyApproval() {
    setPendingCodexApprovalForRoom(selectedRoomId, null);
    setApprovalVisibleForRoom(selectedRoomId, false);
  }

  function onOpenLocalPreview(previewId: string) {
    const preview = localPreviews.find((item) => item.id === previewId);
    if (preview?.publicUrl) window.open(preview.publicUrl, "_blank", "noopener,noreferrer");
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
    onDenyApproval,
    onApproveApproval: () => approveCodexTurn(),
    onInvokeCodex: () => handleCodexInvoke(),
    onOpenLocalPreview,
    onCopyLocalPreviewLink,
    onStopLocalPreview: (previewId: string) => void stopLocalPreview(previewId),
    onDraftChange: (nextDraft: string) => setDraftForRoom(selectedRoomId, nextDraft)
  };
}

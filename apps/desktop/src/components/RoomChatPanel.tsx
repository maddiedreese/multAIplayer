import React from "react";
import type { CodexApprovalSummaryDisplay } from "./CodexApprovalCard";
import { RoomChatContent } from "./RoomChatContent";
import { RoomChatComposer } from "./RoomChatComposer";
import { useRoomGoalTicker } from "../hooks/useRoomGoalTicker";
import type { CodexActivity, RoomGoal } from "../types";

export interface RoomChatAttachmentDisplay {
  id: string;
  name: string;
  meta: string;
  encryptedBlob: boolean;
  canPreview: boolean;
  image?: {
    src: string;
    alt: string;
  };
}

export interface RoomChatReactionDisplay {
  emoji: string;
  count: number;
  active: boolean;
  title: string;
}

export interface RoomChatMessageDisplay {
  id: string;
  author: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  edited?: boolean;
  deleted?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  replyPreview?: {
    author: string;
    body: string;
  } | null;
  selected: boolean;
  attachments: RoomChatAttachmentDisplay[];
  reactions: RoomChatReactionDisplay[];
}

export interface LocalPreviewCardDisplay {
  id: string;
  sharedBy: string;
  sourceUrl: string;
  publicUrl?: string;
  status: "starting" | "live" | "stopped" | "error";
  statusLabel: string;
  message?: string;
  canStop: boolean;
}

export interface PendingAttachmentDisplay {
  id: string;
  name: string;
  encryptedBlob: boolean;
}

export interface QueuedCodexTurnDisplay {
  turnId: string;
  requestedBy: string;
  requestedByUserId?: string;
  queuedAt: string;
  messagesSinceLastCodex: number;
  canCancel?: boolean;
}

export function RoomChatPanel({
  messages,
  codexActivities = [],
  approvalVisible,
  approvalSummary,
  isActiveHost,
  codexRunning,
  canApproveCodex,
  canUseChat,
  canSendMessage,
  roomLocked,
  lockedPlaceholder,
  chatEnabled,
  draft,
  pendingAttachments,
  replyTarget,
  queuedCodexTurns = [],
  roomGoal,
  localPreviewCards = [],
  pendingAttachmentSummary,
  markdownSelectionMode,
  onToggleMessageSelection,
  onCopyMessageMarkdown,
  onOpenAttachment,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onDenyApproval,
  onApproveApproval,
  onInvokeCodex,
  onRemovePendingAttachment,
  onPauseGoal,
  onResumeGoal,
  onEditGoal,
  onDeleteGoal,
  onTickGoalElapsed,
  onOpenLocalPreview,
  onCopyLocalPreviewLink,
  onStopLocalPreview,
  onOpenFileSelector,
  onReplyToMessage,
  onCancelReply,
  onCancelQueuedCodexTurn,
  onDraftChange,
  onSendMessage
}: {
  messages: RoomChatMessageDisplay[];
  codexActivities?: readonly CodexActivity[];
  approvalVisible: boolean;
  approvalSummary: CodexApprovalSummaryDisplay;
  isActiveHost: boolean;
  codexRunning: boolean;
  canApproveCodex: boolean;
  canUseChat: boolean;
  canSendMessage: boolean;
  roomLocked: boolean;
  lockedPlaceholder: string;
  chatEnabled: boolean;
  draft: string;
  pendingAttachments: PendingAttachmentDisplay[];
  replyTarget?: {
    author: string;
    body: string;
  } | null;
  queuedCodexTurns?: QueuedCodexTurnDisplay[];
  roomGoal: RoomGoal | null;
  localPreviewCards: LocalPreviewCardDisplay[];
  pendingAttachmentSummary: string;
  markdownSelectionMode: boolean;
  onToggleMessageSelection: (messageId: string) => void;
  onCopyMessageMarkdown: (messageId: string) => void;
  onOpenAttachment: (messageId: string, attachmentId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEditMessage: (messageId: string, nextBody: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onDenyApproval: () => void;
  onApproveApproval: () => void;
  onInvokeCodex: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onPauseGoal: () => void;
  onResumeGoal: () => void;
  onEditGoal: (text: string) => void;
  onDeleteGoal: () => void;
  onTickGoalElapsed: () => void;
  onOpenLocalPreview: (previewId: string) => void;
  onCopyLocalPreviewLink: (previewId: string) => void;
  onStopLocalPreview: (previewId: string) => void;
  onOpenFileSelector: () => void;
  onReplyToMessage: (messageId: string) => void;
  onCancelReply: () => void;
  onCancelQueuedCodexTurn: (turnId: string) => void;
  onDraftChange: (draft: string) => void;
  onSendMessage: () => void;
}) {
  useRoomGoalTicker(roomGoal, onTickGoalElapsed);

  return (
    <>
      <RoomChatContent
        messages={messages}
        codexActivities={codexActivities}
        localPreviewCards={localPreviewCards}
        approvalVisible={approvalVisible}
        approvalSummary={approvalSummary}
        isActiveHost={isActiveHost}
        codexRunning={codexRunning}
        canApproveCodex={canApproveCodex}
        canUseChat={canUseChat}
        roomLocked={roomLocked}
        queuedCodexTurns={queuedCodexTurns}
        markdownSelectionMode={markdownSelectionMode}
        onToggleMessageSelection={onToggleMessageSelection}
        onCopyMessageMarkdown={onCopyMessageMarkdown}
        onOpenAttachment={onOpenAttachment}
        onToggleReaction={onToggleReaction}
        onEditMessage={onEditMessage}
        onDeleteMessage={onDeleteMessage}
        onReplyToMessage={onReplyToMessage}
        onOpenLocalPreview={onOpenLocalPreview}
        onCopyLocalPreviewLink={onCopyLocalPreviewLink}
        onStopLocalPreview={onStopLocalPreview}
        onDenyApproval={onDenyApproval}
        onApproveApproval={onApproveApproval}
        onCancelQueuedCodexTurn={onCancelQueuedCodexTurn}
      />
      <RoomChatComposer
        roomGoal={roomGoal}
        pendingAttachments={pendingAttachments}
        pendingAttachmentSummary={pendingAttachmentSummary}
        replyTarget={replyTarget}
        roomLocked={roomLocked}
        lockedPlaceholder={lockedPlaceholder}
        chatEnabled={chatEnabled}
        canUseChat={canUseChat}
        canSendMessage={canSendMessage}
        draft={draft}
        onPauseGoal={onPauseGoal}
        onResumeGoal={onResumeGoal}
        onEditGoal={onEditGoal}
        onDeleteGoal={onDeleteGoal}
        onInvokeCodex={onInvokeCodex}
        onOpenFileSelector={onOpenFileSelector}
        onRemovePendingAttachment={onRemovePendingAttachment}
        onCancelReply={onCancelReply}
        onDraftChange={onDraftChange}
        onSendMessage={onSendMessage}
      />
    </>
  );
}

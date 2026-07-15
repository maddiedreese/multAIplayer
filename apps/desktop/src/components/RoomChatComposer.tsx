import React from "react";
import { Bot, FileCode2, Paperclip, Send, X } from "lucide-react";
import { RoomGoalPopup } from "./RoomGoalPopup";
import type { PendingAttachmentDisplay } from "./RoomChatPanel";
import type { RoomGoal } from "../types";
import {
  loadCodexFollowUpBehavior,
  saveCodexFollowUpBehavior,
  type CodexFollowUpBehavior
} from "../lib/codex/codexFollowUpBehavior";

export function RoomChatComposer({
  onboardingAnchor,
  roomGoal,
  codexRunning,
  isActiveHost,
  pendingAttachments,
  pendingAttachmentSummary,
  replyTarget,
  roomLocked,
  lockedPlaceholder,
  chatEnabled,
  canUseChat,
  canSendMessage,
  draft,
  onPauseGoal,
  onResumeGoal,
  onEditGoal,
  onDeleteGoal,
  onInvokeCodex,
  onOpenFileSelector,
  onRemovePendingAttachment,
  onCancelReply,
  onDraftChange,
  onSendMessage
}: {
  onboardingAnchor?: string;
  roomGoal: RoomGoal | null;
  codexRunning: boolean;
  isActiveHost: boolean;
  pendingAttachments: PendingAttachmentDisplay[];
  pendingAttachmentSummary: string;
  replyTarget?: { author: string; body: string } | null;
  roomLocked: boolean;
  lockedPlaceholder: string;
  chatEnabled: boolean;
  canUseChat: boolean;
  canSendMessage: boolean;
  draft: string;
  onPauseGoal: () => void;
  onResumeGoal: () => void;
  onEditGoal: (text: string) => void;
  onDeleteGoal: () => void;
  onInvokeCodex: () => void;
  onOpenFileSelector: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onCancelReply: () => void;
  onDraftChange: (draft: string) => void;
  onSendMessage: () => void;
}) {
  const [followUpBehavior, setFollowUpBehavior] = React.useState<CodexFollowUpBehavior>(() =>
    loadCodexFollowUpBehavior()
  );

  function updateFollowUpBehavior(behavior: CodexFollowUpBehavior) {
    setFollowUpBehavior(behavior);
    saveCodexFollowUpBehavior(behavior);
  }

  return (
    <footer className="composer" data-onboarding-anchor={onboardingAnchor}>
      {roomGoal && (
        <RoomGoalPopup
          goal={roomGoal}
          onPause={onPauseGoal}
          onResume={onResumeGoal}
          onEdit={onEditGoal}
          onDelete={onDeleteGoal}
        />
      )}
      <button title="Invoke Codex" aria-label="Invoke Codex" onClick={onInvokeCodex} disabled={!canUseChat}>
        <Bot size={18} />
      </button>
      <button
        title="Attach project file"
        aria-label="Attach project file"
        onClick={onOpenFileSelector}
        disabled={!canUseChat || roomLocked}
      >
        <Paperclip size={18} />
      </button>
      <div className="composer-body">
        {codexRunning && isActiveHost && (
          <label className="codex-follow-up-behavior">
            <span>While Codex works</span>
            <select
              value={followUpBehavior}
              onChange={(event) => updateFollowUpBehavior(event.target.value as CodexFollowUpBehavior)}
              aria-label="Codex follow-up behavior"
            >
              <option value="steer">Steer current turn</option>
              <option value="queue">Queue next turn</option>
            </select>
          </label>
        )}
        {pendingAttachments.length > 0 && (
          <div className="pending-attachments">
            {pendingAttachments.map((attachment) => (
              <span key={attachment.id}>
                <FileCode2 size={13} />
                {attachment.name}
                {attachment.encryptedBlob ? " (encrypted blob)" : ""}
                <button
                  onClick={() => onRemovePendingAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <small>{pendingAttachmentSummary}</small>
          </div>
        )}
        {replyTarget && (
          <div className="composer-reply-target">
            <div>
              <strong>Replying to {replyTarget.author}</strong>
              <span>{replyTarget.body}</span>
            </div>
            <button onClick={onCancelReply} aria-label="Cancel reply">
              <X size={12} />
            </button>
          </div>
        )}
        <textarea
          placeholder={
            roomLocked
              ? lockedPlaceholder
              : chatEnabled
                ? "Message the room, or type @Codex to invoke the active host..."
                : "Chat is unavailable"
          }
          value={draft}
          disabled={!canUseChat}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSendMessage) onSendMessage();
            }
          }}
        />
      </div>
      <button className="send" onClick={onSendMessage} disabled={!canSendMessage} aria-label="Send message">
        <Send size={18} />
      </button>
    </footer>
  );
}

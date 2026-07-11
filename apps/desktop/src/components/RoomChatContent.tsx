import React from "react";
import { Bot, Copy, ExternalLink, FileCode2, Pencil, Square, Trash2, X } from "lucide-react";
import { CodexApprovalCard, type CodexApprovalSummaryDisplay } from "./CodexApprovalCard";
import type { LocalPreviewCardDisplay, QueuedCodexTurnDisplay, RoomChatMessageDisplay } from "./RoomChatPanel";

export interface RoomChatContentProps {
  messages: RoomChatMessageDisplay[];
  localPreviewCards: LocalPreviewCardDisplay[];
  approvalVisible: boolean;
  approvalSummary: CodexApprovalSummaryDisplay;
  isActiveHost: boolean;
  codexRunning: boolean;
  canApproveCodex: boolean;
  canUseChat: boolean;
  roomLocked: boolean;
  queuedCodexTurns: QueuedCodexTurnDisplay[];
  markdownSelectionMode: boolean;
  onToggleMessageSelection: (messageId: string) => void;
  onCopyMessageMarkdown: (messageId: string) => void;
  onOpenAttachment: (messageId: string, attachmentId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEditMessage: (messageId: string, nextBody: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onReplyToMessage: (messageId: string) => void;
  onOpenLocalPreview: (previewId: string) => void;
  onCopyLocalPreviewLink: (previewId: string) => void;
  onStopLocalPreview: (previewId: string) => void;
  onDenyApproval: () => void;
  onApproveApproval: () => void;
  onCancelQueuedCodexTurn: (turnId: string) => void;
}

export function RoomChatContent({
  messages,
  localPreviewCards,
  approvalVisible,
  approvalSummary,
  isActiveHost,
  codexRunning,
  canApproveCodex,
  canUseChat,
  roomLocked,
  queuedCodexTurns,
  markdownSelectionMode,
  onToggleMessageSelection,
  onCopyMessageMarkdown,
  onOpenAttachment,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onReplyToMessage,
  onOpenLocalPreview,
  onCopyLocalPreviewLink,
  onStopLocalPreview,
  onDenyApproval,
  onApproveApproval,
  onCancelQueuedCodexTurn
}: RoomChatContentProps) {
  return (
    <div className="chat-scroll">
      {messages.map((message) => {
        const visibleReactions = message.reactions.filter((reaction) => reaction.count > 0 || reaction.active);

        return (
          <article className={`message ${message.role} ${message.selected ? "selected" : ""}`} key={message.id}>
            <div className="avatar">{message.role === "codex" ? <Bot size={17} /> : message.author.slice(0, 1)}</div>
            <div className="bubble">
              <div className="message-meta">
                {markdownSelectionMode && (
                  <label className="message-select" title="Select message for Markdown copy">
                    <input
                      type="checkbox"
                      checked={message.selected}
                      onChange={() => onToggleMessageSelection(message.id)}
                      aria-label={`Select message from ${message.author} at ${message.time}`}
                    />
                  </label>
                )}
                <strong>{message.author}</strong>
                <span>{message.time}</span>
                <button
                  onClick={() => onCopyMessageMarkdown(message.id)}
                  title="Copy message as Markdown"
                  aria-label={`Copy message from ${message.author} as Markdown`}
                >
                  <Copy size={13} />
                </button>
                {message.edited && <span>(edited)</span>}
                {message.canEdit && (
                  <button
                    onClick={() => {
                      const nextBody = window.prompt("Edit message", message.body);
                      if (nextBody !== null && nextBody.trim() && nextBody !== message.body) {
                        onEditMessage(message.id, nextBody.trim());
                      }
                    }}
                    title="Edit message"
                    aria-label={`Edit message from ${message.author}`}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {message.canDelete && (
                  <button
                    onClick={() => {
                      if (window.confirm("Delete this message before Codex uses it?")) {
                        onDeleteMessage(message.id);
                      }
                    }}
                    title="Delete message"
                    aria-label={`Delete message from ${message.author}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
                <button
                  className="message-reply-button"
                  onClick={() => onReplyToMessage(message.id)}
                  title="Reply to message"
                  aria-label={`Reply to message from ${message.author}`}
                  disabled={!canUseChat || roomLocked}
                >
                  Reply
                </button>
              </div>
              {message.replyPreview && (
                <div className="reply-preview">
                  <strong>{message.replyPreview.author}</strong>
                  <span>{message.replyPreview.body}</span>
                </div>
              )}
              <p>{message.body}</p>
              {message.attachments.map((attachment) => (
                <button
                  className="attachment"
                  key={attachment.id}
                  onClick={() => {
                    if (attachment.canPreview && !roomLocked) onOpenAttachment(message.id, attachment.id);
                  }}
                  title={attachment.canPreview ? "Open in file editor" : undefined}
                  disabled={!attachment.canPreview || roomLocked}
                >
                  <FileCode2 size={15} />
                  <span>{attachment.name}</span>
                  <small>{attachment.meta}</small>
                </button>
              ))}
              {visibleReactions.length > 0 && (
                <div className="reaction-row">
                  {visibleReactions.map((reaction) => (
                    <button
                      className={reaction.active ? "active" : ""}
                      key={reaction.emoji}
                      onClick={() => onToggleReaction(message.id, reaction.emoji)}
                      title={reaction.title}
                      disabled={!canUseChat}
                    >
                      <span>{reaction.emoji}</span>
                      {reaction.count ? <small>{reaction.count}</small> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </article>
        );
      })}

      {localPreviewCards.map((preview) => (
        <article className="message system local-preview-message" key={preview.id}>
          <div className="avatar">P</div>
          <div className="bubble local-preview-card">
            <div className="message-meta">
              <strong>Live local preview</strong>
              <span>{preview.statusLabel}</span>
            </div>
            <dl>
              <div>
                <dt>Shared by</dt>
                <dd>{preview.sharedBy}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{preview.sourceUrl}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{preview.statusLabel}</dd>
              </div>
              {preview.publicUrl && preview.status === "live" && (
                <div>
                  <dt>URL</dt>
                  <dd>{preview.publicUrl}</dd>
                </div>
              )}
            </dl>
            {preview.status === "stopped" && <p>This preview is no longer available.</p>}
            {preview.message && preview.status !== "stopped" && <p>{preview.message}</p>}
            <div className="local-preview-actions">
              <button
                onClick={() => onOpenLocalPreview(preview.id)}
                disabled={!preview.publicUrl || preview.status !== "live"}
              >
                <ExternalLink size={14} />
                Open Preview
              </button>
              <button onClick={() => onCopyLocalPreviewLink(preview.id)} disabled={!preview.publicUrl}>
                <Copy size={14} />
                Copy Link
              </button>
              {preview.canStop && (
                <button
                  onClick={() => onStopLocalPreview(preview.id)}
                  disabled={preview.status !== "live" && preview.status !== "starting"}
                >
                  <Square size={13} />
                  Stop Sharing
                </button>
              )}
            </div>
          </div>
        </article>
      ))}

      {approvalVisible && (
        <CodexApprovalCard
          summary={approvalSummary}
          isActiveHost={isActiveHost}
          codexRunning={codexRunning}
          canApprove={canApproveCodex}
          onDeny={onDenyApproval}
          onApprove={onApproveApproval}
        />
      )}
      {queuedCodexTurns.length > 0 && (
        <section className="codex-queue" aria-label="Queued Codex turns">
          <div className="codex-queue-title">
            <Bot size={15} />
            <strong>Codex queue</strong>
            <span>{queuedCodexTurns.length} waiting</span>
          </div>
          {queuedCodexTurns.map((turn, index) => (
            <div className="codex-queue-row" key={turn.turnId}>
              <span>{index + 1}</span>
              <div>
                <strong>{turn.requestedBy}</strong>
                <small>
                  {turn.messagesSinceLastCodex} message{turn.messagesSinceLastCodex === 1 ? "" : "s"} ready at turn
                  start
                </small>
              </div>
              <button onClick={() => onCancelQueuedCodexTurn(turn.turnId)} disabled={roomLocked || !turn.canCancel}>
                <X size={13} />
                Cancel
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

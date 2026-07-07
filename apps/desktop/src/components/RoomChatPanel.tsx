import { Bot, Copy, ExternalLink, FileCode2, Paperclip, Send, Square, X } from "lucide-react";
import { CodexApprovalCard, type CodexApprovalSummaryDisplay } from "./CodexApprovalCard";

export interface RoomChatAttachmentDisplay {
  id: string;
  name: string;
  meta: string;
  encryptedBlob: boolean;
  canPreview: boolean;
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

export function RoomChatPanel({
  messages,
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
  localPreviewCards = [],
  pendingAttachmentSummary,
  markdownSelectionMode,
  onToggleMessageSelection,
  onCopyMessageMarkdown,
  onCopyCodexOutputMarkdown,
  onOpenAttachment,
  onToggleReaction,
  onDenyApproval,
  onApproveApproval,
  onInvokeCodex,
  onRemovePendingAttachment,
  onOpenLocalPreview,
  onCopyLocalPreviewLink,
  onStopLocalPreview,
  onOpenFileSelector,
  onDraftChange,
  onSendMessage
}: {
  messages: RoomChatMessageDisplay[];
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
  localPreviewCards: LocalPreviewCardDisplay[];
  pendingAttachmentSummary: string;
  markdownSelectionMode: boolean;
  onToggleMessageSelection: (messageId: string) => void;
  onCopyMessageMarkdown: (messageId: string) => void;
  onCopyCodexOutputMarkdown: (messageId: string) => void;
  onOpenAttachment: (messageId: string, attachmentId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDenyApproval: () => void;
  onApproveApproval: () => void;
  onInvokeCodex: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onOpenLocalPreview: (previewId: string) => void;
  onCopyLocalPreviewLink: (previewId: string) => void;
  onStopLocalPreview: (previewId: string) => void;
  onOpenFileSelector: () => void;
  onDraftChange: (draft: string) => void;
  onSendMessage: () => void;
}) {
  return (
    <>
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
                  {message.role === "codex" && (
                    <button
                      onClick={() => onCopyCodexOutputMarkdown(message.id)}
                      title="Copy Codex turn output as Markdown"
                      aria-label={`Copy Codex turn output from ${message.time} as Markdown`}
                    >
                      <Bot size={13} />
                    </button>
                  )}
                </div>
                <p>{message.body}</p>
                {message.attachments.map((attachment) => (
                  <button
                    className="attachment"
                    key={attachment.id}
                    onClick={() => {
                      if (attachment.canPreview && !roomLocked) onOpenAttachment(message.id, attachment.id);
                    }}
                    title={attachment.canPreview ? "Open in file viewer" : undefined}
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
                <strong>Live Local Preview</strong>
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
                <button onClick={() => onOpenLocalPreview(preview.id)} disabled={!preview.publicUrl || preview.status !== "live"}>
                  <ExternalLink size={14} />
                  Open Preview
                </button>
                <button onClick={() => onCopyLocalPreviewLink(preview.id)} disabled={!preview.publicUrl}>
                  <Copy size={14} />
                  Copy Link
                </button>
                {preview.canStop && (
                  <button onClick={() => onStopLocalPreview(preview.id)} disabled={preview.status !== "live" && preview.status !== "starting"}>
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
      </div>

      <footer className="composer">
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
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments">
              {pendingAttachments.map((attachment) => (
                <span key={attachment.id}>
                  <FileCode2 size={13} />
                  {attachment.name}{attachment.encryptedBlob ? " (encrypted blob)" : ""}
                  <button onClick={() => onRemovePendingAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <small>{pendingAttachmentSummary}</small>
            </div>
          )}
          <textarea
            placeholder={
              roomLocked
                ? lockedPlaceholder
                : chatEnabled
                  ? "Message the room, or type @Codex to invoke the active host..."
                  : "Chat mode is disabled for this room"
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
    </>
  );
}

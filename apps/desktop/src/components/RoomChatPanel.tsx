import { Bot, Copy, ExternalLink, FileCode2, Send, X } from "lucide-react";
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
  pendingAttachmentSummary,
  onToggleMessageSelection,
  onCopyMessageMarkdown,
  onCopyCodexOutputMarkdown,
  onOpenAttachment,
  onToggleReaction,
  onDenyApproval,
  onApproveApproval,
  onInvokeCodex,
  onRemovePendingAttachment,
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
  pendingAttachmentSummary: string;
  onToggleMessageSelection: (messageId: string) => void;
  onCopyMessageMarkdown: (messageId: string) => void;
  onCopyCodexOutputMarkdown: (messageId: string) => void;
  onOpenAttachment: (messageId: string, attachmentId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDenyApproval: () => void;
  onApproveApproval: () => void;
  onInvokeCodex: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onDraftChange: (draft: string) => void;
  onSendMessage: () => void;
}) {
  return (
    <>
      <div className="chat-scroll">
        {messages.map((message) => (
          <article className={`message ${message.role} ${message.selected ? "selected" : ""}`} key={message.id}>
            <div className="avatar">{message.role === "codex" ? <Bot size={17} /> : message.author.slice(0, 1)}</div>
            <div className="bubble">
              <div className="message-meta">
                <label className="message-select" title="Select message for Markdown copy">
                  <input
                    type="checkbox"
                    checked={message.selected}
                    onChange={() => onToggleMessageSelection(message.id)}
                    aria-label={`Select message from ${message.author} at ${message.time}`}
                  />
                </label>
                <strong>{message.author}</strong>
                <span>{message.time}</span>
                <button onClick={() => onCopyMessageMarkdown(message.id)} title="Copy message as Markdown">
                  <Copy size={13} />
                </button>
                {message.role === "codex" && (
                  <button onClick={() => onCopyCodexOutputMarkdown(message.id)} title="Copy Codex turn output as Markdown">
                    <Bot size={13} />
                  </button>
                )}
              </div>
              <p>{message.body}</p>
              {message.attachments.map((attachment) => (
                <div className="attachment" key={attachment.id}>
                  <FileCode2 size={15} />
                  <span>{attachment.name}</span>
                  <small>{attachment.meta}</small>
                  {attachment.canPreview && (
                    <button
                      onClick={() => onOpenAttachment(message.id, attachment.id)}
                      title={attachment.encryptedBlob ? "Decrypt and preview encrypted attachment" : "Preview inline attachment"}
                      disabled={roomLocked}
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="reaction-row">
                {message.reactions.map((reaction) => (
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
        <button title="Invoke Codex" onClick={onInvokeCodex} disabled={!canUseChat}>
          <Bot size={18} />
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
        <button className="send" onClick={onSendMessage} disabled={!canSendMessage}>
          <Send size={18} />
        </button>
      </footer>
    </>
  );
}

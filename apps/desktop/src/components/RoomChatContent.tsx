import React from "react";
import { Bot, Check, Copy, ExternalLink, FileCode2, Pencil, Square, Trash2, X } from "lucide-react";
import { CodexApprovalCard, type CodexApprovalSummaryDisplay } from "./CodexApprovalCard";
import { CodexActivityFeed } from "./CodexActivityDisclosure";
import type { LocalPreviewCardDisplay, QueuedCodexTurnDisplay, RoomChatMessageDisplay } from "./RoomChatPanel";
import type { CodexActivity } from "../types";

export interface RoomChatContentProps {
  onboardingAnchor?: string;
  messages: RoomChatMessageDisplay[];
  codexActivities: readonly CodexActivity[];
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
  onboardingAnchor,
  messages,
  codexActivities,
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
    <div className="chat-scroll" data-onboarding-anchor={onboardingAnchor}>
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
              <ChatMessageMarkdown body={message.body} />
              {message.attachments.map((attachment) => (
                <React.Fragment key={attachment.id}>
                  {attachment.image && (
                    <figure className="chat-image-attachment">
                      <img src={attachment.image.src} alt={attachment.image.alt} loading="lazy" decoding="async" />
                      <figcaption>{attachment.name}</figcaption>
                    </figure>
                  )}
                  <button
                    className="attachment"
                    onClick={() => {
                      if (attachment.canPreview && !roomLocked) onOpenAttachment(message.id, attachment.id);
                    }}
                    title={attachment.canPreview ? "Open attachment" : undefined}
                    disabled={!attachment.canPreview || roomLocked}
                  >
                    <FileCode2 size={15} />
                    <span>{attachment.name}</span>
                    <small>{attachment.meta}</small>
                  </button>
                </React.Fragment>
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

      <CodexActivityFeed activities={codexActivities} />

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
        <div data-onboarding-anchor="approval-card" tabIndex={-1}>
          <CodexApprovalCard
            summary={approvalSummary}
            isActiveHost={isActiveHost}
            codexRunning={codexRunning}
            canApprove={canApproveCodex}
            onDeny={onDenyApproval}
            onApprove={onApproveApproval}
          />
        </div>
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

type MarkdownBlock = { kind: "text"; value: string } | { kind: "code"; value: string; language: string };

export function ChatMessageMarkdown({ body }: { body: string }) {
  const blocks = parseMarkdownBlocks(body);
  return (
    <div className="message-markdown">
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <ChatCodeBlock key={index} code={block.value} language={block.language} />
        ) : (
          <React.Fragment key={index}>
            {block.value.split(/\n[ \t]*\n/).map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{renderInlineCode(paragraph)}</p>
            ))}
          </React.Fragment>
        )
      )}
    </div>
  );
}

function ChatCodeBlock({ code, language }: { code: string; language: string }) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const label = language ? `${language} code` : "code";
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <div className="chat-code-block">
      <div className="chat-code-toolbar">
        <span>{language || "Code"}</span>
        <button type="button" onClick={() => void copyCode()} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
          {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
          <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {copyState === "copied"
          ? "Code copied to clipboard."
          : copyState === "failed"
            ? "Code could not be copied."
            : ""}
      </span>
    </div>
  );
}

export function parseMarkdownBlocks(body: string): MarkdownBlock[] {
  const lines = body.split("\n");
  const blocks: MarkdownBlock[] = [];
  let textLines: string[] = [];
  const flushText = () => {
    if (textLines.length) blocks.push({ kind: "text", value: textLines.join("\n") });
    textLines = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^ {0,3}```([A-Za-z0-9_+.#-]*)[ \t]*$/.exec(lines[index]);
    if (!opening) {
      textLines.push(lines[index]);
      continue;
    }
    flushText();
    const codeLines: string[] = [];
    index += 1;
    while (index < lines.length && !/^ {0,3}```[ \t]*$/.test(lines[index])) {
      codeLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "code", value: codeLines.join("\n"), language: opening[1] ?? "" });
  }
  flushText();
  return blocks.length ? blocks : [{ kind: "text", value: "" }];
}

function renderInlineCode(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("`", cursor);
    if (start < 0) {
      nodes.push(value.slice(cursor));
      break;
    }
    let runEnd = start;
    while (value[runEnd] === "`") runEnd += 1;
    const delimiter = value.slice(start, runEnd);
    const end = value.indexOf(delimiter, runEnd);
    if (end < 0) {
      nodes.push(value.slice(cursor));
      break;
    }
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(<code key={`${start}-${end}`}>{value.slice(runEnd, end)}</code>);
    cursor = end + delimiter.length;
  }
  if (value === "") nodes.push("");
  return nodes;
}

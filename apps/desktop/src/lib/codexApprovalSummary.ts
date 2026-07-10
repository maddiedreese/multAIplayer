import type { ChatMessage } from "../types";
import { formatBytes } from "./appFormatters";

export function formatApprovalMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return "No new messages.";
  const visible = messages.slice(-6).map((message) => {
    const body = message.body.replace(/\s+/g, " ").trim();
    return `${message.author}: ${body.length > 140 ? `${body.slice(0, 137)}...` : body}`;
  });
  const hidden = messages.length - visible.length;
  return hidden > 0
    ? [`${hidden} earlier message${hidden === 1 ? "" : "s"}`, ...visible].join("\n")
    : visible.join("\n");
}

export function formatApprovalAttachments(messages: ChatMessage[]): string {
  const attachments = messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => `${attachment.name} (${formatBytes(attachment.size)})`)
  );
  if (attachments.length === 0) return "None";
  const visible = attachments.slice(-8);
  const hidden = attachments.length - visible.length;
  return hidden > 0
    ? [`${hidden} earlier attachment${hidden === 1 ? "" : "s"}`, ...visible].join("\n")
    : visible.join("\n");
}

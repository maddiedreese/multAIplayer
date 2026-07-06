import { codexModelOptions, maxEmbeddedAttachmentBytes, maxEmbeddedAttachmentBytesPerMessage, maxMessageAttachments, type TeamRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "./authClient";
import type { ChatAttachment } from "../types";

export function formatCodexModel(model: string): string {
  return codexModelOptions.find((option) => option.id === model)?.label ?? model;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTeamMeta(team: TeamRecord): string {
  const members = `${team.members} ${team.members === 1 ? "member" : "members"}`;
  return team.role ? `${formatTeamRole(team.role)} · ${members}` : members;
}

export function formatTeamRole(role: NonNullable<TeamRecord["role"]>): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export function formatTeamMemberInitial(userId: string): string {
  return userId.replace(/^github:/, "").slice(0, 1).toUpperCase() || "?";
}

export function formatTeamMemberName(userId: string, currentUser: SignedInUser | null): string {
  if (currentUser?.id === userId) return currentUser.name ?? currentUser.login;
  return userId.replace(/^github:/, "");
}

export function formatTeamMemberJoinedAt(joinedAt: string): string {
  const timestamp = Date.parse(joinedAt);
  if (Number.isNaN(timestamp)) return "joined";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "unknown time";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatMessageTime(value = new Date().toISOString()): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "now";
  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function validatePendingAttachments(attachments: ChatAttachment[]): string | null {
  if (attachments.length > maxMessageAttachments) {
    return `Attach up to ${maxMessageAttachments} files per message in the alpha.`;
  }
  const oversized = attachments.find((attachment) =>
    attachment.content ? encodedBytes(attachment.content) > maxEmbeddedAttachmentBytes : false
  );
  if (oversized) {
    return `${oversized.name} is too large to embed. Limit: ${formatBytes(maxEmbeddedAttachmentBytes)} per file.`;
  }
  const totalBytes = embeddedAttachmentBytes(attachments);
  if (totalBytes > maxEmbeddedAttachmentBytesPerMessage) {
    return `Attachment previews are ${formatBytes(totalBytes)}. Limit: ${formatBytes(maxEmbeddedAttachmentBytesPerMessage)} per message.`;
  }
  return null;
}

export function embeddedAttachmentBytes(attachments: ChatAttachment[]): number {
  return attachments.reduce((total, attachment) => total + encodedBytes(attachment.content ?? ""), 0);
}

export function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function formatAttachmentMeta(attachment: ChatAttachment): string {
  const blobNote = attachment.blobId ? `, encrypted blob${attachment.blobBytes ? ` preview ${formatBytes(attachment.blobBytes)}` : ""}` : "";
  return `${attachment.type}, ${formatBytes(attachment.size)}${blobNote}`;
}

export function canOpenChatAttachment(attachment: ChatAttachment): boolean {
  return Boolean(attachment.blobId || attachment.content || canOpenProjectAttachment(attachment));
}

export function canOpenProjectAttachment(attachment: ChatAttachment): boolean {
  const name = attachment.name.trim();
  if (!name || name.startsWith("/") || name.includes("..") || name.includes("\0")) return false;
  return attachment.type === "code" || name.includes("/") || /\.[a-z0-9]{1,12}$/i.test(name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

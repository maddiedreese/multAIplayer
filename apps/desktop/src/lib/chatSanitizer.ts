import { maxEmbeddedAttachmentBytes, maxMessageAttachments } from "@multaiplayer/protocol";

export interface SanitizedChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string;
  blobId?: string;
  blobBytes?: number;
  truncated?: boolean;
}

export interface SanitizedChatMessage {
  id: string;
  author: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  createdAt?: string;
  attachments?: SanitizedChatAttachment[];
  [key: string]: unknown;
}

export function normalizeChatMessage(value: unknown): SanitizedChatMessage | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.author !== "string" ||
    !isChatRole(value.role) ||
    typeof value.body !== "string" ||
    typeof value.time !== "string" ||
    (value.createdAt !== undefined && typeof value.createdAt !== "string") ||
    (value.replyTo !== undefined && (typeof value.replyTo !== "string" || value.replyTo.trim() === ""))
  ) {
    return null;
  }

  const attachments = Array.isArray(value.attachments)
    ? normalizeChatAttachments(value.attachments)
    : undefined;

  return {
    ...value,
    id: value.id,
    author: value.author,
    role: value.role,
    body: value.body,
    time: value.time,
    ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    ...(typeof value.replyTo === "string" ? { replyTo: value.replyTo } : {}),
    ...(attachments?.length ? { attachments } : { attachments: undefined })
  };
}

export function normalizeChatAttachments(values: unknown[]): SanitizedChatAttachment[] {
  return values
    .slice(0, maxMessageAttachments)
    .map((value, index) => normalizeChatAttachment(value, index))
    .filter((attachment): attachment is SanitizedChatAttachment => attachment !== null);
}

export function normalizeChatAttachment(value: unknown, index = 0): SanitizedChatAttachment | null {
  if (!isRecord(value)) return null;
  const name = sanitizeAttachmentName(value.name, index);
  const content = typeof value.content === "string" ? value.content.slice(0, maxEmbeddedAttachmentBytes) : undefined;
  const blobBytes = finiteNonnegativeInteger(value.blobBytes);
  const contentBytes = content === undefined ? undefined : encodedBytes(content);
  const size = finiteNonnegativeInteger(value.size) ?? contentBytes ?? blobBytes ?? 0;
  const type = sanitizeAttachmentType(value.type, name);
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `attachment-${index + 1}`,
    name,
    type,
    size,
    ...(content !== undefined ? { content } : {}),
    ...(typeof value.blobId === "string" && value.blobId.trim() ? { blobId: value.blobId } : {}),
    ...(blobBytes !== undefined ? { blobBytes } : {}),
    ...(value.truncated === true || (typeof value.content === "string" && value.content.length > maxEmbeddedAttachmentBytes)
      ? { truncated: true }
      : {})
  };
}

function sanitizeAttachmentName(value: unknown, index: number): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return `Attachment ${index + 1}`;
}

function sanitizeAttachmentType(value: unknown, name: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (!extension) return "file";
  if (["png", "jpg", "jpeg", "gif", "webp", "sketch"].includes(extension)) return "image";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "md", "json"].includes(extension)) return "code";
  return "file";
}

function finiteNonnegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isChatRole(value: unknown): value is SanitizedChatMessage["role"] {
  return value === "human" || value === "codex" || value === "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

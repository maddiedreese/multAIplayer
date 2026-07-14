import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { CodexGeneratedImage } from "./localBackend";
import { encryptMlsBlob } from "./mlsClient";
import { createAttachmentBlob } from "./workspaceClient";
import type { ChatAttachment } from "../types";
import { reportExpectedFailure } from "./nonFatalReporting";

const supportedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const thumbnailTargetBytes = 72_000;
const thumbnailMaxEdge = 960;

export async function createCodexImageAttachment(
  room: Pick<RoomRecord, "id" | "teamId">,
  image: CodexGeneratedImage
): Promise<ChatAttachment> {
  const dataUrl = normalizeGeneratedImageData(image);
  const fullBytes = encodedBytes(dataUrl);
  const attachment: ChatAttachment = {
    id: crypto.randomUUID(),
    name: safeGeneratedImageName(image.name, image.mimeType),
    type: image.mimeType,
    size: fullBytes
  };

  if (fullBytes <= maxEmbeddedAttachmentBytes) {
    attachment.content = dataUrl;
    return attachment;
  }

  const thumbnail = await createImageThumbnail(dataUrl).catch((_error) => {
    reportExpectedFailure("create a generated-image thumbnail");
    return null;
  });
  if (thumbnail && encodedBytes(thumbnail) <= maxEmbeddedAttachmentBytes) {
    attachment.content = thumbnail;
    attachment.truncated = true;
  }

  const blobId = `blob_${crypto.randomUUID()}`;
  const sealed = await encryptMlsBlob(room.id, blobId, {
    name: attachment.name,
    type: attachment.type,
    size: fullBytes,
    content: dataUrl,
    generatedBy: "codex-imagegen",
    ...(image.prompt ? { prompt: image.prompt } : {})
  });
  const blob = await createAttachmentBlob({
    blobId,
    teamId: room.teamId,
    roomId: room.id,
    name: attachment.name,
    type: attachment.type,
    size: fullBytes,
    epoch: sealed.epoch,
    sealedBlob: JSON.stringify(sealed)
  });
  attachment.blobId = blob.id;
  attachment.blobBytes = fullBytes;
  return attachment;
}

export function normalizeGeneratedImageData(image: Pick<CodexGeneratedImage, "data" | "mimeType">): string {
  const mimeType = image.mimeType.toLowerCase();
  if (!supportedImageMimeTypes.has(mimeType)) {
    throw new Error(`Codex returned an unsupported generated-image type: ${image.mimeType}`);
  }
  const value = image.data.trim();
  const dataUrlMatch = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (dataUrlMatch) {
    const declaredType = dataUrlMatch[1]?.toLowerCase();
    if (declaredType !== mimeType || !supportedImageMimeTypes.has(declaredType)) {
      throw new Error("Codex generated-image data did not match its declared media type.");
    }
    return `data:${declaredType};base64,${normalizeBase64(dataUrlMatch[2] ?? "")}`;
  }
  return `data:${mimeType};base64,${normalizeBase64(value)}`;
}

export function safeGeneratedImageName(name: string, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "");
  const base = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  if (!base) return `codex-image.${extension}`;
  const normalizedBase = base.replace(/\.[A-Za-z0-9]+$/, "");
  return `${normalizedBase}.${extension}`;
}

export async function createImageThumbnail(dataUrl: string): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, thumbnailMaxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * scale));
  let height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const quality = Math.max(0.45, 0.82 - attempt * 0.09);
    const thumbnail = canvas.toDataURL("image/jpeg", quality);
    if (encodedBytes(thumbnail) <= thumbnailTargetBytes) return thumbnail;
    width = Math.max(1, Math.round(width * 0.76));
    height = Math.max(1, Math.round(height * 0.76));
  }
  return null;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Codex generated image could not be decoded."));
    image.src = dataUrl;
  });
}

function normalizeBase64(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("Codex returned malformed generated-image data.");
  }
  return compact;
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

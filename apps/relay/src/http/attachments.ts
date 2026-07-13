import type { Express, Response } from "express";
import {
  maxAttachmentBlobIdChars,
  type AttachmentBlobRecord as AttachmentBlobRecordType
} from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import { isStrictExporterCiphertextJson } from "../opaque.js";

interface RegisterAttachmentRoutesOptions {
  app: Express;
  store: RelayStore;
  attachmentBlobMaxBytes: number;
  attachmentBlobLiveQuotaBytes: number;
  attachmentBlobUploadBytesPerWindow: number;
  attachmentBlobUploadWindowMs: number;
  attachmentBlobTtlDays: number;
  maxAttachmentBlobNameChars: number;
  maxAttachmentBlobTypeChars: number;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  recordQuotaRejection?: (type: string) => void;
  recordUpload?: (bytes: number) => void;
  recordUploadRejection?: (reason: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxCiphertextCharactersForBlob: (maxBytes: number) => number;
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean;
}

interface ByteQuotaRecord {
  bytes: number;
  resetAt: number;
}

const attachmentBlobUploadByteCounts = new Map<string, ByteQuotaRecord>();

export function registerAttachmentRoutes({
  app,
  store,
  attachmentBlobMaxBytes,
  attachmentBlobLiveQuotaBytes,
  attachmentBlobUploadBytesPerWindow,
  attachmentBlobUploadWindowMs,
  attachmentBlobTtlDays,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  getAuthSession,
  allowRead,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave,
  recordQuotaRejection,
  recordUpload,
  recordUploadRejection,
  normalizeMetadataText,
  maxCiphertextCharactersForBlob,
  isExpiredAttachmentBlob
}: RegisterAttachmentRoutesOptions) {
  app.post("/attachment-blobs", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    if (!hasExactKeys(req.body, ["blobId", "teamId", "roomId", "name", "type", "size", "epoch", "sealedBlob"]))
      return void res.status(400).json({ error: "Attachment blob contains unsupported fields." });
    const teamId = String(req.body?.teamId ?? "");
    const roomId = String(req.body?.roomId ?? "");
    const blobId = normalizeMetadataText(req.body?.blobId, maxAttachmentBlobIdChars);
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (store.getRoom(roomId)?.teamId !== teamId) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (!blobId) {
      res.status(400).json({ error: "blobId is required and must be bounded." });
      return;
    }
    if (store.getAttachmentBlob(blobId)) {
      res.status(409).json({ error: "blobId already exists." });
      return;
    }
    if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
      res.status(403).json({ error: "Join this room before uploading attachment blobs." });
      return;
    }

    const name = normalizeMetadataText(req.body?.name, maxAttachmentBlobNameChars);
    const requestedType = String(req.body?.type ?? "file").trim() || "file";
    const type = normalizeMetadataText(requestedType, maxAttachmentBlobTypeChars);
    const size = Number(req.body?.size);
    const epoch = Number(req.body?.epoch);
    const sealedBlob = typeof req.body?.sealedBlob === "string" ? req.body.sealedBlob : "";
    if (!name) {
      res.status(400).json({ error: "name must be a non-empty string up to 512 characters" });
      return;
    }
    if (!type) {
      res
        .status(400)
        .json({ error: "type must be a non-empty string up to 160 characters without control characters" });
      return;
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      res.status(400).json({ error: "size must be a non-negative integer" });
      return;
    }
    if (size > attachmentBlobMaxBytes) {
      recordUploadRejection?.("max_size");
      res.status(413).json({ error: `Attachment blob size exceeds ${attachmentBlobMaxBytes} bytes` });
      return;
    }
    if (!Number.isSafeInteger(epoch) || epoch < 0 || !sealedBlob) {
      res.status(400).json({ error: "epoch and sealedBlob are required" });
      return;
    }
    if (sealedBlob.length > maxCiphertextCharactersForBlob(attachmentBlobMaxBytes)) {
      recordUploadRejection?.("ciphertext_size");
      res.status(413).json({ error: `Attachment blob ciphertext exceeds ${attachmentBlobMaxBytes} bytes` });
      return;
    }
    if (!isStrictExporterCiphertextJson(sealedBlob, maxCiphertextCharactersForBlob(attachmentBlobMaxBytes))) {
      recordUploadRejection?.("ciphertext_encoding");
      res.status(400).json({ error: "sealedBlob must be a canonical exporter ciphertext record" });
      return;
    }
    if (session) {
      const usedBytes = liveAttachmentBlobBytesForUser(store, session.user.id, isExpiredAttachmentBlob);
      if (usedBytes + size > attachmentBlobLiveQuotaBytes) {
        recordQuotaRejection?.("live_attachment_blob_bytes");
        recordUploadRejection?.("live_quota");
        res.status(413).json({
          error: "Live encrypted attachment blob storage quota exceeded.",
          code: "quota_exceeded",
          quota: {
            type: "live_attachment_blob_bytes",
            limit: attachmentBlobLiveQuotaBytes,
            used: usedBytes,
            remaining: Math.max(0, attachmentBlobLiveQuotaBytes - usedBytes)
          }
        });
        return;
      }
      if (
        !consumeAttachmentUploadByteQuota({
          userId: session.user.id,
          bytes: size,
          limit: attachmentBlobUploadBytesPerWindow,
          windowMs: attachmentBlobUploadWindowMs,
          recordQuotaRejection,
          recordUploadRejection,
          res
        })
      ) {
        return;
      }
    }

    const blob: AttachmentBlobRecordType = {
      id: blobId,
      teamId,
      roomId,
      name,
      type,
      size,
      ...(session ? { uploadedByUserId: session.user.id } : {}),
      epoch,
      sealedBlob,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + attachmentBlobTtlDays * 24 * 60 * 60 * 1000).toISOString()
    };
    store.setAttachmentBlob(blob);
    recordUpload?.(size);
    scheduleStoreSave();
    res.status(201).json({ blob });
  });

  app.get("/attachment-blobs/:blobId", (req, res) => {
    const blob = store.getAttachmentBlob(req.params.blobId);
    if (!blob) {
      res.status(404).json({ error: "Attachment blob not found" });
      return;
    }
    const teamId = String(req.query.teamId ?? "");
    const roomId = String(req.query.roomId ?? "");
    if (!teamId || !roomId) {
      res.status(400).json({ error: "teamId and roomId are required" });
      return;
    }
    if (blob.teamId !== teamId || blob.roomId !== roomId) {
      res.status(404).json({ error: "Attachment blob not found" });
      return;
    }
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
      res.status(403).json({ error: "Join this room before reading attachment blobs." });
      return;
    }
    if (isExpiredAttachmentBlob(blob)) {
      store.deleteAttachmentBlob(blob.id);
      scheduleStoreSave();
      res.status(410).json({ error: "Attachment blob expired" });
      return;
    }
    res.json({ blob });
  });
}

function hasExactKeys(value: unknown, allowed: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function consumeAttachmentUploadByteQuota({
  userId,
  bytes,
  limit,
  windowMs,
  recordQuotaRejection,
  recordUploadRejection,
  res
}: {
  userId: string;
  bytes: number;
  limit: number;
  windowMs: number;
  recordQuotaRejection?: (type: string) => void;
  recordUploadRejection?: (reason: string) => void;
  res: Response;
}): boolean {
  const quota = "attachment_blob_upload_bytes";
  const now = Date.now();
  pruneByteQuotaRecords(attachmentBlobUploadByteCounts, now);
  const current = attachmentBlobUploadByteCounts.get(userId);
  const record = current && current.resetAt > now ? current : { bytes: 0, resetAt: now + windowMs };
  if (record.bytes + bytes > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    recordQuotaRejection?.(quota);
    recordUploadRejection?.("upload_byte_quota");
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      error: "Encrypted attachment blob upload byte quota exceeded.",
      code: "quota_exceeded",
      retryAfterSeconds,
      quota: {
        type: quota,
        limit,
        used: record.bytes,
        remaining: Math.max(0, limit - record.bytes),
        resetsAt: new Date(record.resetAt).toISOString()
      }
    });
    return false;
  }
  attachmentBlobUploadByteCounts.set(userId, {
    bytes: record.bytes + bytes,
    resetAt: record.resetAt
  });
  return true;
}

function pruneByteQuotaRecords(records: Map<string, ByteQuotaRecord>, now = Date.now()) {
  if (records.size < 10_000) return;
  for (const [key, record] of records.entries()) {
    if (record.resetAt <= now) records.delete(key);
  }
}

function liveAttachmentBlobBytesForUser(
  store: RelayStore,
  userId: string,
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean
): number {
  let total = 0;
  for (const blob of store.attachmentBlobs.values()) {
    if (blob.uploadedByUserId !== userId || isExpiredAttachmentBlob(blob)) continue;
    total += blob.size;
  }
  return total;
}

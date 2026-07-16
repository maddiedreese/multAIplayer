import { sendRelayCapacityError, sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import {
  maxAttachmentBlobIdChars,
  type AttachmentBlobRecord as AttachmentBlobRecordType
} from "@multaiplayer/protocol";
import {
  RelayStoreByteCapacityError,
  RelayStoreCapacityError,
  type AccountQuotaRecord,
  type AuthSession,
  type RelayStore
} from "../state.js";
import { isStrictExporterCiphertextJson } from "../opaque.js";
import { acquireDurableQuotaTransaction, reserveDurableQuota, rollbackDurableQuota } from "../auth/account-quotas.js";

interface RegisterAttachmentRoutesOptions {
  app: Express;
  store: RelayStore;
  attachmentBlobMaxBytes: number;
  attachmentBlobLiveQuotaBytes: number;
  attachmentBlobTeamLiveQuotaBytes: number;
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
  saveRelayStore: () => Promise<void>;
  reclaimDurableCapacity?: () => Promise<void>;
  recordQuotaRejection?: (type: string) => void;
  recordCapacityRejection?: (resource: string, scope: string) => void;
  recordUpload?: (bytes: number) => void;
  recordUploadRejection?: (reason: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxCiphertextCharactersForBlob: (maxBytes: number) => number;
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean;
}

export function registerAttachmentRoutes(options: RegisterAttachmentRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowRead,
    allowMutation,
    canAccessRoom,
    scheduleStoreSave,
    isExpiredAttachmentBlob
  } = options;
  app.post("/attachment-blobs", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    try {
      await options.reclaimDurableCapacity?.();
    } catch {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not reclaim expired durable relay state.");
    }

    const target = validateAttachmentTarget(options, req.body, session, res);
    if (!target) return;
    const payload = validateAttachmentPayload(options, req.body, res);
    if (!payload) return;
    await persistAttachmentUpload(options, session, target, payload, res);
  });

  app.get("/attachment-blobs/:blobId", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const blob = store.getAttachmentBlob(req.params.blobId);
    if (!blob) {
      sendRelayError(res, 404, "not_found", "Attachment blob not found");
      return;
    }
    const teamId = String(req.query.teamId ?? "");
    const roomId = String(req.query.roomId ?? "");
    if (!teamId || !roomId) {
      sendRelayError(res, 400, "invalid_request", "teamId and roomId are required");
      return;
    }
    if (blob.teamId !== teamId || blob.roomId !== roomId) {
      sendRelayError(res, 404, "not_found", "Attachment blob not found");
      return;
    }
    if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
      sendRelayError(res, 403, "forbidden", "Join this room before reading attachment blobs.");
      return;
    }
    if (isExpiredAttachmentBlob(blob)) {
      store.deleteAttachmentBlob(blob.id);
      scheduleStoreSave();
      sendRelayError(res, 410, "invite_expired", "Attachment blob expired");
      return;
    }
    res.json({ blob });
  });
}

async function persistAttachmentUpload(
  options: RegisterAttachmentRoutesOptions,
  session: AuthSession | null,
  target: { teamId: string; roomId: string; blobId: string },
  payload: NonNullable<ReturnType<typeof validateAttachmentPayload>>,
  res: Response
) {
  const {
    store,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobTeamLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow,
    attachmentBlobUploadWindowMs,
    attachmentBlobTtlDays,
    scheduleStoreSave,
    saveRelayStore,
    recordQuotaRejection,
    recordUploadRejection,
    isExpiredAttachmentBlob
  } = options;
  const { teamId, roomId, blobId } = target;
  const { name, type, size, epoch, sealedBlob, storageBytes } = payload;
  const releaseQuotaTransaction = await acquireDurableQuotaTransaction(store);
  let reservation: ReturnType<typeof reserveAttachmentQuota> | null = null;
  let blob: AttachmentBlobRecordType | null = null;
  let durableCommitCompleted = false;
  try {
    reservation = session
      ? reserveAttachmentQuota({
          store,
          session,
          teamId,
          storageBytes,
          liveLimit: attachmentBlobLiveQuotaBytes,
          teamLiveLimit: attachmentBlobTeamLiveQuotaBytes,
          uploadLimit: attachmentBlobUploadBytesPerWindow,
          uploadWindowMs: attachmentBlobUploadWindowMs,
          isExpiredAttachmentBlob,
          ...(recordQuotaRejection ? { recordQuotaRejection } : {}),
          ...(recordUploadRejection ? { recordUploadRejection } : {}),
          res
        })
      : null;
    if (session && !reservation) return;

    blob = {
      id: blobId,
      teamId,
      roomId,
      name,
      type,
      size,
      ...attachmentUploader(session),
      epoch,
      sealedBlob,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + attachmentBlobTtlDays * 24 * 60 * 60 * 1000).toISOString()
    };
    store.setAttachmentBlob(blob);
    if (session) {
      await saveRelayStore();
    } else {
      scheduleStoreSave();
    }
    durableCommitCompleted = true;
    options.recordUpload?.(storageBytes);
    res.status(201).json({ blob });
  } catch (error) {
    if (durableCommitCompleted) throw error;
    if (blob) store.deleteAttachmentBlob(blob.id);
    if (reservation) rollbackDurableQuota(store, reservation);
    if (error instanceof RelayStoreCapacityError || error instanceof RelayStoreByteCapacityError) {
      options.recordCapacityRejection?.(
        error instanceof RelayStoreByteCapacityError ? error.resource : "durable_entries",
        error instanceof RelayStoreByteCapacityError ? error.scope : error.teamId ? "team" : "relay"
      );
      return void sendRelayCapacityError(res, error);
    }
    return void sendRelayError(
      res,
      503,
      "persistence_unavailable",
      "Could not persist attachment blob and upload quota."
    );
  } finally {
    releaseQuotaTransaction();
  }
}

function attachmentUploader(session: AuthSession | null): { uploadedByUserId?: string } {
  return session ? { uploadedByUserId: session.user.id } : {};
}

function validateAttachmentTarget(
  options: RegisterAttachmentRoutesOptions,
  body: unknown,
  session: AuthSession | null,
  res: Response
): { teamId: string; roomId: string; blobId: string } | null {
  if (!hasExactKeys(body, ["blobId", "teamId", "roomId", "name", "type", "size", "epoch", "sealedBlob"])) {
    sendRelayError(res, 400, "invalid_request", "Attachment blob contains unsupported fields.");
    return null;
  }
  const teamId = String(body.teamId ?? "");
  const roomId = String(body.roomId ?? "");
  const blobId = options.normalizeMetadataText(body.blobId, maxAttachmentBlobIdChars);
  if (!options.store.hasTeam(teamId)) return sendAttachmentTargetError(res, 404, "team_not_found", "Team not found");
  if (options.store.getRoom(roomId)?.teamId !== teamId) {
    return sendAttachmentTargetError(res, 404, "room_not_found", "Room not found");
  }
  if (!blobId) return sendAttachmentTargetError(res, 400, "invalid_request", "blobId is required and must be bounded.");
  if (options.store.getAttachmentBlob(blobId)) {
    return sendAttachmentTargetError(res, 409, "conflict", "blobId already exists.");
  }
  if (session && !options.canAccessRoom(teamId, roomId, session.user.id)) {
    return sendAttachmentTargetError(res, 403, "forbidden", "Join this room before uploading attachment blobs.");
  }
  return { teamId, roomId, blobId };
}

function sendAttachmentTargetError(
  res: Response,
  status: number,
  code: "team_not_found" | "room_not_found" | "invalid_request" | "conflict" | "forbidden",
  message: string
): null {
  sendRelayError(res, status, code, message);
  return null;
}

function validateAttachmentPayload(
  options: RegisterAttachmentRoutesOptions,
  body: Record<string, unknown>,
  res: Response
):
  | (Pick<AttachmentBlobRecordType, "name" | "type" | "size" | "epoch" | "sealedBlob"> & {
      storageBytes: number;
    })
  | null {
  const name = options.normalizeMetadataText(body.name, options.maxAttachmentBlobNameChars);
  const requestedType = String(body.type ?? "file").trim() || "file";
  const type = options.normalizeMetadataText(requestedType, options.maxAttachmentBlobTypeChars);
  const size = Number(body.size);
  const epoch = Number(body.epoch);
  const sealedBlob = typeof body.sealedBlob === "string" ? body.sealedBlob : "";
  if (!name) return attachmentPayloadError(res, "name must be a non-empty string up to 512 characters");
  if (!type) return attachmentPayloadError(res, "type must be a non-empty bounded string without control characters");
  if (!Number.isSafeInteger(size) || size < 0)
    return attachmentPayloadError(res, "size must be a non-negative integer");
  if (size > options.attachmentBlobMaxBytes) {
    options.recordUploadRejection?.("max_size");
    return attachmentPayloadError(res, `Attachment blob size exceeds ${options.attachmentBlobMaxBytes} bytes`, 413);
  }
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !sealedBlob) {
    return attachmentPayloadError(res, "epoch and sealedBlob are required");
  }
  const maxCiphertextChars = options.maxCiphertextCharactersForBlob(options.attachmentBlobMaxBytes);
  if (sealedBlob.length > maxCiphertextChars) {
    options.recordUploadRejection?.("ciphertext_size");
    return attachmentPayloadError(
      res,
      `Attachment blob ciphertext exceeds ${options.attachmentBlobMaxBytes} bytes`,
      413
    );
  }
  if (!isStrictExporterCiphertextJson(sealedBlob, maxCiphertextChars)) {
    options.recordUploadRejection?.("ciphertext_encoding");
    return attachmentPayloadError(res, "sealedBlob must be a canonical exporter ciphertext record");
  }
  return { name, type, size, epoch, sealedBlob, storageBytes: Buffer.byteLength(sealedBlob, "utf8") };
}

function attachmentPayloadError(res: Response, message: string, status = 400): null {
  sendRelayError(res, status, status === 413 ? "payload_too_large" : "invalid_request", message);
  return null;
}

type AllowedQuotaReservation = {
  amount: number;
  record: AccountQuotaRecord;
};

function reserveAttachmentQuota({
  store,
  session,
  teamId,
  storageBytes,
  liveLimit,
  teamLiveLimit,
  uploadLimit,
  uploadWindowMs,
  isExpiredAttachmentBlob,
  recordQuotaRejection,
  recordUploadRejection,
  res
}: {
  store: RelayStore;
  session: AuthSession;
  teamId: string;
  storageBytes: number;
  liveLimit: number;
  teamLiveLimit: number;
  uploadLimit: number;
  uploadWindowMs: number;
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean;
  recordQuotaRejection?: (type: string) => void;
  recordUploadRejection?: (reason: string) => void;
  res: Response;
}): AllowedQuotaReservation | null {
  const usedBytes = liveAttachmentBlobBytesForUser(store, session.user.id, isExpiredAttachmentBlob);
  if (usedBytes + storageBytes > liveLimit) {
    recordQuotaRejection?.("live_attachment_blob_bytes");
    recordUploadRejection?.("live_quota");
    sendRelayError(res, 413, "quota_exceeded", "Live encrypted attachment blob storage quota exceeded.", {
      quota: {
        type: "live_attachment_blob_bytes",
        limit: liveLimit,
        used: usedBytes,
        remaining: Math.max(0, liveLimit - usedBytes)
      }
    });
    return null;
  }
  const teamUsedBytes = liveAttachmentBlobBytesForTeam(store, teamId, isExpiredAttachmentBlob);
  if (teamUsedBytes + storageBytes > teamLiveLimit) {
    recordQuotaRejection?.("team_live_attachment_blob_bytes");
    recordUploadRejection?.("team_live_quota");
    sendRelayError(res, 413, "quota_exceeded", "Team encrypted attachment blob storage quota exceeded.", {
      quota: {
        type: "team_live_attachment_blob_bytes",
        limit: teamLiveLimit,
        used: teamUsedBytes,
        remaining: Math.max(0, teamLiveLimit - teamUsedBytes)
      }
    });
    return null;
  }
  const reservation = reserveDurableQuota({
    store,
    quota: "attachment_upload_bytes",
    userId: session.user.id,
    amount: storageBytes,
    limit: uploadLimit,
    resetAt: Date.now() + uploadWindowMs
  });
  if (reservation.allowed) return reservation;
  sendUploadQuotaExceeded({
    limit: uploadLimit,
    used: reservation.used,
    resetAt: reservation.resetAt,
    ...(recordQuotaRejection ? { recordQuotaRejection } : {}),
    ...(recordUploadRejection ? { recordUploadRejection } : {}),
    res
  });
  return null;
}

function hasExactKeys(value: unknown, allowed: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function sendUploadQuotaExceeded({
  limit,
  used,
  resetAt,
  recordQuotaRejection,
  recordUploadRejection,
  res
}: {
  limit: number;
  used: number;
  resetAt: number;
  recordQuotaRejection?: (type: string) => void;
  recordUploadRejection?: (reason: string) => void;
  res: Response;
}) {
  const quota = "attachment_blob_upload_bytes";
  const now = Date.now();
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  recordQuotaRejection?.(quota);
  recordUploadRejection?.("upload_byte_quota");
  res.setHeader("Retry-After", String(retryAfterSeconds));
  sendRelayError(res, 429, "quota_exceeded", "Encrypted attachment blob upload byte quota exceeded.", {
    retryAfterSeconds,
    quota: {
      type: quota,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt: new Date(resetAt).toISOString()
    }
  });
}

function liveAttachmentBlobBytesForUser(
  store: RelayStore,
  userId: string,
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean
): number {
  let total = 0;
  for (const blob of store.attachmentBlobs.values()) {
    if (blob.uploadedByUserId !== userId || isExpiredAttachmentBlob(blob)) continue;
    total += attachmentBlobStorageBytes(blob);
  }
  return total;
}

function liveAttachmentBlobBytesForTeam(
  store: RelayStore,
  teamId: string,
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean
): number {
  let total = 0;
  for (const blob of store.attachmentBlobs.values()) {
    if (blob.teamId !== teamId || isExpiredAttachmentBlob(blob)) continue;
    total += attachmentBlobStorageBytes(blob);
  }
  return total;
}

export function attachmentBlobStorageBytes(blob: Pick<AttachmentBlobRecordType, "sealedBlob">): number {
  return Buffer.byteLength(blob.sealedBlob, "utf8");
}

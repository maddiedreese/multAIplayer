import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import {
  CiphertextPayload,
  type AttachmentBlobRecord as AttachmentBlobRecordType
} from "@multaiplayer/protocol";
import type { AuthSession } from "../state.js";

interface RegisterAttachmentRoutesOptions {
  app: Express;
  teams: Map<string, unknown>;
  rooms: Map<string, { teamId: string }>;
  attachmentBlobs: Map<string, AttachmentBlobRecordType>;
  attachmentBlobMaxBytes: number;
  attachmentBlobTtlDays: number;
  maxAttachmentBlobNameChars: number;
  maxAttachmentBlobTypeChars: number;
  maxEnvelopeNonceChars: number;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxCiphertextCharactersForBlob: (maxBytes: number) => number;
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecordType) => boolean;
}

export function registerAttachmentRoutes({
  app,
  teams,
  rooms,
  attachmentBlobs,
  attachmentBlobMaxBytes,
  attachmentBlobTtlDays,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxEnvelopeNonceChars,
  getAuthSession,
  allowRead,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave,
  normalizeMetadataText,
  maxCiphertextCharactersForBlob,
  isExpiredAttachmentBlob
}: RegisterAttachmentRoutesOptions) {
  app.post("/attachment-blobs", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.body?.teamId ?? "");
    const roomId = String(req.body?.roomId ?? "");
    if (!teams.has(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!rooms.has(roomId) || rooms.get(roomId)?.teamId !== teamId) {
      res.status(404).json({ error: "Room not found" });
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
    const payload = CiphertextPayload.safeParse(req.body?.payload);
    if (!name) {
      res.status(400).json({ error: "name must be a non-empty string up to 512 characters" });
      return;
    }
    if (!type) {
      res.status(400).json({ error: "type must be a non-empty string up to 160 characters without control characters" });
      return;
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      res.status(400).json({ error: "size must be a non-negative integer" });
      return;
    }
    if (size > attachmentBlobMaxBytes) {
      res.status(413).json({ error: `Attachment blob size exceeds ${attachmentBlobMaxBytes} bytes` });
      return;
    }
    if (!payload.success) {
      res.status(400).json({ error: "payload must be a valid ciphertext payload" });
      return;
    }
    if (payload.data.nonce.length > maxEnvelopeNonceChars) {
      res.status(413).json({ error: `Attachment blob nonce exceeds ${maxEnvelopeNonceChars} characters` });
      return;
    }
    if (payload.data.ciphertext.length > maxCiphertextCharactersForBlob(attachmentBlobMaxBytes)) {
      res.status(413).json({ error: `Attachment blob ciphertext exceeds ${attachmentBlobMaxBytes} bytes` });
      return;
    }

    const blob: AttachmentBlobRecordType = {
      id: `blob_${nanoid(16)}`,
      teamId,
      roomId,
      name,
      type,
      size,
      payload: payload.data,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + attachmentBlobTtlDays * 24 * 60 * 60 * 1000).toISOString()
    };
    attachmentBlobs.set(blob.id, blob);
    scheduleStoreSave();
    res.status(201).json({ blob });
  });

  app.get("/attachment-blobs/:blobId", (req, res) => {
    const blob = attachmentBlobs.get(req.params.blobId);
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
      attachmentBlobs.delete(blob.id);
      scheduleStoreSave();
      res.status(410).json({ error: "Attachment blob expired" });
      return;
    }
    res.json({ blob });
  });
}

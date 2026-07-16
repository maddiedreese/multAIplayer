import { sendRelayError } from "./errors.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Response } from "express";
import { KeyPackageUpload, pinnedMlsCiphersuite, type KeyPackageRecord, type RoomRecord } from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import type { KeyPackageValidator } from "../mls/key-package-validator.js";
import { isCanonicalPaddedBase64 } from "../opaque.js";
import { hasDeviceSession } from "./device-auth.js";
import { commitValidatedKeyPackages, type KeyPackageUploadCommitResult } from "./key-package-upload-transaction.js";
import { consumeKeyPackageForInvite } from "./key-package-consumption-transaction.js";

const maxBatchSize = 20;
const maxLivePackagesPerDevice = 50;
const maxEncodedKeyPackageChars = 32_768;

interface Options {
  app: Express;
  store: RelayStore;
  validator: KeyPackageValidator;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  saveRelayStore: () => Promise<void>;
  liveKeyPackageCapPerUser: number;
  recordQuotaRejection?: (type: string) => void;
}

export function registerKeyPackageRoutes({
  app,
  store,
  validator,
  getAuthSession,
  allowRead,
  allowMutation,
  saveRelayStore,
  liveKeyPackageCapPerUser,
  recordQuotaRejection
}: Options) {
  app.post("/devices/:deviceId/key-packages", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session)
      return void sendRelayError(res, 401, "authentication_required", "Sign in before publishing KeyPackages.");
    const deviceId = String(req.params.deviceId ?? "");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, deviceId))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (!store.getDevice(session.user.id, deviceId)) {
      return void sendRelayError(
        res,
        403,
        "device_auth_required",
        "Register this device before publishing KeyPackages."
      );
    }
    if (
      !Array.isArray(req.body?.keyPackages) ||
      req.body.keyPackages.length < 1 ||
      req.body.keyPackages.length > maxBatchSize
    ) {
      return void sendRelayError(res, 400, "invalid_request", `keyPackages must contain 1-${maxBatchSize} items.`);
    }
    if (
      store.keyPackagesForDevice(session.user.id, deviceId).length + req.body.keyPackages.length >
      maxLivePackagesPerDevice
    ) {
      return void sendRelayError(res, 409, "conflict", "KeyPackage live limit exceeded.");
    }
    if (
      rejectAccountKeyPackageQuota(
        store,
        session.user.id,
        req.body.keyPackages.length,
        liveKeyPackageCapPerUser,
        res,
        recordQuotaRejection
      )
    )
      return;
    const accepted = await validateKeyPackageBatch(
      req.body.keyPackages as unknown[],
      store,
      validator,
      session,
      deviceId,
      res
    );
    if (!accepted) return;
    const committed = await commitValidatedKeyPackages({
      store,
      userId: session.user.id,
      deviceId,
      accepted,
      accountLimit: liveKeyPackageCapPerUser,
      deviceLimit: maxLivePackagesPerDevice,
      persist: saveRelayStore
    });
    respondToKeyPackageCommit(committed, liveKeyPackageCapPerUser, res, recordQuotaRejection);
  });

  app.get("/devices/:deviceId/key-packages/count", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    if (!session)
      return void sendRelayError(res, 401, "authentication_required", "Sign in before reading KeyPackage counts.");
    const deviceId = String(req.params.deviceId ?? "");
    if (!store.getDevice(session.user.id, deviceId))
      return void sendRelayError(res, 404, "not_found", "Device not found.");
    res.json({ count: store.keyPackagesForDevice(session.user.id, deviceId).length });
  });

  app.post("/rooms/:roomId/key-packages/:userId/:deviceId/consume", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session)
      return void sendRelayError(res, 401, "authentication_required", "Sign in before consuming a KeyPackage.");
    const room = store.getRoom(String(req.params.roomId));
    const hostDeviceId = String(body.hostDeviceId ?? "");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, hostDeviceId))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (!room) return void sendRelayError(res, 404, "room_not_found", "Room not found.");
    if (!isActiveRoomHost(room, session.user.id, hostDeviceId)) {
      return void sendRelayError(res, 403, "forbidden", "Only the active host device may consume KeyPackages.");
    }
    const keyPackageId = String(body.keyPackageId ?? "");
    const keyPackageHash = String(body.keyPackageHash ?? "");
    const result = await consumeKeyPackageForInvite({
      store,
      teamId: room.teamId,
      roomId: room.id,
      expectedHostUserId: session.user.id,
      expectedHostDeviceId: hostDeviceId,
      inviteId: String(body.inviteId ?? ""),
      userId: String(req.params.userId),
      deviceId: String(req.params.deviceId),
      keyPackageId,
      keyPackageHash,
      persist: saveRelayStore
    });
    if (result.status === "authorization_changed")
      return void sendRelayError(res, 403, "forbidden", "Active host authority changed before KeyPackage consumption.");
    if (result.status === "invite_mismatch")
      return void sendRelayError(res, 403, "forbidden", "A valid room invite approval is required.");
    if (result.status === "request_mismatch")
      return void sendRelayError(res, 409, "conflict", "KeyPackage does not match the pending invite request.");
    if (result.status === "key_package_unavailable")
      return void sendRelayError(res, 404, "key_package_unavailable", "No KeyPackage is available.");
    if (result.status === "key_package_mismatch")
      return void sendRelayError(res, 409, "conflict", "KeyPackage does not match the pending invite request.");
    if (result.status === "persistence_unavailable") {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not consume KeyPackage durably.");
    }
    if (result.status === "already_consumed") {
      return void res.json({
        alreadyConsumed: true,
        keyPackageId,
        keyPackageHash,
        userId: String(req.params.userId),
        deviceId: String(req.params.deviceId)
      });
    }
    res.json({ keyPackage: result.keyPackage });
  });
}

function respondToKeyPackageCommit(
  result: KeyPackageUploadCommitResult,
  accountLimit: number,
  res: Response,
  recordQuotaRejection?: (type: string) => void
): void {
  if (result.status === "accepted") return void res.status(201).json({ count: result.count });
  if (result.status === "device_quota") {
    return void sendRelayError(res, 409, "conflict", "KeyPackage live limit exceeded.");
  }
  if (result.status === "conflict") {
    return void sendRelayError(res, 409, "conflict", "KeyPackage id already exists.");
  }
  if (result.status === "persistence_unavailable") {
    return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist KeyPackages.");
  }
  recordQuotaRejection?.("live_key_packages_per_user");
  sendRelayError(res, 429, "quota_exceeded", "Account KeyPackage quota exceeded.", {
    quota: {
      type: "live_key_packages_per_user",
      limit: accountLimit,
      used: result.used,
      remaining: Math.max(0, accountLimit - result.used)
    }
  });
}

async function validateKeyPackageBatch(
  candidates: unknown[],
  store: RelayStore,
  validator: KeyPackageValidator,
  session: AuthSession,
  deviceId: string,
  res: Response
): Promise<KeyPackageRecord[] | null> {
  const accepted: KeyPackageRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const item = await validateUploadedKeyPackage(candidate, seen, store, validator, session, deviceId, res);
    if (!item) return null;
    accepted.push(item);
  }
  return accepted;
}

async function validateUploadedKeyPackage(
  candidate: unknown,
  seen: Set<string>,
  store: RelayStore,
  validator: KeyPackageValidator,
  session: AuthSession,
  deviceId: string,
  res: Response
): Promise<KeyPackageRecord | null> {
  const parsed = KeyPackageUpload.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.keyPackage.length > maxEncodedKeyPackageChars ||
    seen.has(parsed.success ? parsed.data.id : "")
  ) {
    return keyPackageUploadError(res, 400, "key_package_invalid", "Invalid or duplicate KeyPackage.");
  }
  seen.add(parsed.data.id);
  if (
    parsed.data.ciphersuite !== pinnedMlsCiphersuite ||
    !isCanonicalPaddedBase64(parsed.data.keyPackage, maxEncodedKeyPackageChars)
  ) {
    return keyPackageUploadError(res, 400, "key_package_invalid", "Invalid KeyPackage encoding or ciphersuite.");
  }
  if (!constantTimeEqual(parsed.data.keyPackageHash, hashKeyPackage(parsed.data.keyPackage))) {
    return keyPackageUploadError(res, 400, "key_package_invalid", "KeyPackage hash mismatch.");
  }
  if (store.keyPackages.has(parsed.data.id))
    return keyPackageUploadError(res, 409, "conflict", "KeyPackage id already exists.");
  const device = store.getDevice(session.user.id, deviceId);
  if (!device) return keyPackageUploadError(res, 400, "key_package_invalid", "Registered device identity is required.");
  const validated = await validator.validate(parsed.data, {
    userId: session.user.id,
    deviceId,
    signaturePublicKey: device.signaturePublicKey,
    signatureKeyFingerprint: device.signatureKeyFingerprint
  });
  if (!validatedUploaderMatches(validated, session.user.id, deviceId, device)) {
    return keyPackageUploadError(res, 400, "key_package_invalid", "KeyPackage credential does not match its uploader.");
  }
  return {
    ...parsed.data,
    userId: session.user.id,
    deviceId,
    credentialIdentity: validated.credentialIdentity,
    createdAt: new Date().toISOString()
  };
}

function validatedUploaderMatches(
  value: Awaited<ReturnType<KeyPackageValidator["validate"]>>,
  userId: string,
  deviceId: string,
  device: NonNullable<ReturnType<RelayStore["getDevice"]>>
): value is NonNullable<typeof value> {
  if (!value || value.userId !== userId || value.deviceId !== deviceId) return false;
  if (value.ciphersuite !== pinnedMlsCiphersuite) return false;
  return (
    constantTimeEqual(value.signaturePublicKey, device.signaturePublicKey) &&
    constantTimeEqual(value.signatureKeyFingerprint, device.signatureKeyFingerprint)
  );
}

function keyPackageUploadError(
  res: Response,
  status: number,
  code: "key_package_invalid" | "conflict",
  message: string
): null {
  sendRelayError(res, status, code, message);
  return null;
}

function isActiveRoomHost(room: RoomRecord, userId: string, deviceId: string): boolean {
  return room.hostStatus === "active" && room.hostUserId === userId && room.activeHostDeviceId === deviceId;
}

function rejectAccountKeyPackageQuota(
  store: RelayStore,
  userId: string,
  requested: number,
  limit: number,
  res: Response,
  recordQuotaRejection?: (type: string) => void
): boolean {
  const used = Array.from(store.keyPackages.values()).filter((item) => item.userId === userId).length;
  if (used + requested <= limit) return false;
  recordQuotaRejection?.("live_key_packages_per_user");
  sendRelayError(res, 429, "quota_exceeded", "Account KeyPackage quota exceeded.", {
    quota: {
      type: "live_key_packages_per_user",
      limit,
      used,
      remaining: Math.max(0, limit - used)
    }
  });
  return true;
}

function hashKeyPackage(encoded: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

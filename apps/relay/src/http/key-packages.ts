import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Response } from "express";
import { KeyPackageUpload, pinnedMlsCiphersuite, type KeyPackageRecord } from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import type { KeyPackageValidator } from "../mls/key-package-validator.js";
import { isCanonicalPaddedBase64 } from "../opaque.js";
import { hasDeviceSession } from "./device-auth.js";

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
}

export function registerKeyPackageRoutes({
  app,
  store,
  validator,
  getAuthSession,
  allowRead,
  allowMutation,
  saveRelayStore
}: Options) {
  app.post("/devices/:deviceId/key-packages", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) return void res.status(401).json({ error: "Sign in before publishing KeyPackages." });
    const deviceId = String(req.params.deviceId ?? "");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, deviceId))
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    if (!store.getDevice(session.user.id, deviceId)) {
      return void res.status(403).json({ error: "Register this device before publishing KeyPackages." });
    }
    if (
      !Array.isArray(req.body?.keyPackages) ||
      req.body.keyPackages.length < 1 ||
      req.body.keyPackages.length > maxBatchSize
    ) {
      return void res.status(400).json({ error: `keyPackages must contain 1-${maxBatchSize} items.` });
    }
    if (
      store.keyPackagesForDevice(session.user.id, deviceId).length + req.body.keyPackages.length >
      maxLivePackagesPerDevice
    ) {
      return void res.status(409).json({ error: "KeyPackage live limit exceeded." });
    }
    const accepted: KeyPackageRecord[] = [];
    const seen = new Set<string>();
    for (const candidate of req.body.keyPackages as unknown[]) {
      const parsed = KeyPackageUpload.safeParse(candidate);
      if (
        !parsed.success ||
        parsed.data.keyPackage.length > maxEncodedKeyPackageChars ||
        seen.has(parsed.success ? parsed.data.id : "")
      ) {
        return void res.status(400).json({ error: "Invalid or duplicate KeyPackage.", code: "key_package_invalid" });
      }
      seen.add(parsed.data.id);
      if (
        parsed.data.ciphersuite !== pinnedMlsCiphersuite ||
        !isCanonicalPaddedBase64(parsed.data.keyPackage, maxEncodedKeyPackageChars)
      ) {
        return void res
          .status(400)
          .json({ error: "Invalid KeyPackage encoding or ciphersuite.", code: "key_package_invalid" });
      }
      if (!constantTimeEqual(parsed.data.keyPackageHash, hashKeyPackage(parsed.data.keyPackage))) {
        return void res.status(400).json({ error: "KeyPackage hash mismatch.", code: "key_package_invalid" });
      }
      if (store.keyPackages.has(parsed.data.id)) {
        return void res.status(409).json({ error: "KeyPackage id already exists." });
      }
      const registeredDevice = store.getDevice(session.user.id, deviceId);
      if (!registeredDevice)
        return void res
          .status(400)
          .json({ error: "Registered device identity is required.", code: "key_package_invalid" });
      const validated = await validator.validate(parsed.data, {
        userId: session.user.id,
        deviceId,
        signaturePublicKey: registeredDevice.signaturePublicKey,
        signatureKeyFingerprint: registeredDevice.signatureKeyFingerprint
      });
      if (
        !validated ||
        validated.userId !== session.user.id ||
        validated.deviceId !== deviceId ||
        validated.ciphersuite !== pinnedMlsCiphersuite ||
        !constantTimeEqual(validated.signaturePublicKey, registeredDevice.signaturePublicKey) ||
        !constantTimeEqual(validated.signatureKeyFingerprint, registeredDevice.signatureKeyFingerprint)
      ) {
        return void res
          .status(400)
          .json({ error: "KeyPackage credential does not match its uploader.", code: "key_package_invalid" });
      }
      accepted.push({
        ...parsed.data,
        userId: session.user.id,
        deviceId,
        credentialIdentity: validated.credentialIdentity,
        createdAt: new Date().toISOString()
      });
    }
    for (const item of accepted) store.setKeyPackage(item);
    try {
      await saveRelayStore();
    } catch {
      for (const item of accepted) store.deleteKeyPackage(item.id);
      return void res.status(503).json({ error: "Could not persist KeyPackages." });
    }
    res.status(201).json({ count: store.keyPackagesForDevice(session.user.id, deviceId).length });
  });

  app.get("/devices/:deviceId/key-packages/count", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    if (!session) return void res.status(401).json({ error: "Sign in before reading KeyPackage counts." });
    const deviceId = String(req.params.deviceId ?? "");
    if (!store.getDevice(session.user.id, deviceId)) return void res.status(404).json({ error: "Device not found." });
    res.json({ count: store.keyPackagesForDevice(session.user.id, deviceId).length });
  });

  app.post("/rooms/:roomId/key-packages/:userId/:deviceId/consume", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) return void res.status(401).json({ error: "Sign in before consuming a KeyPackage." });
    const room = store.getRoom(String(req.params.roomId ?? ""));
    const hostDeviceId = String(req.body?.hostDeviceId ?? "");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, hostDeviceId))
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    if (!room) return void res.status(404).json({ error: "Room not found." });
    if (
      room.hostStatus !== "active" ||
      room.hostUserId !== session.user.id ||
      room.activeHostDeviceId !== hostDeviceId
    ) {
      return void res.status(403).json({ error: "Only the active host device may consume KeyPackages." });
    }
    const invite = store.getInvite(String(req.body?.inviteId ?? ""));
    if (!invite || invite.roomId !== room.id || invite.teamId !== room.teamId) {
      return void res.status(403).json({ error: "A valid room invite approval is required." });
    }
    const keyPackageId = String(req.body?.keyPackageId ?? "");
    const keyPackageHash = String(req.body?.keyPackageHash ?? "");
    const request = Array.from(store.inviteRequests.values()).find(
      (candidate) =>
        candidate.inviteId === invite.id &&
        candidate.requesterUserId === String(req.params.userId) &&
        candidate.requesterDeviceId === String(req.params.deviceId) &&
        candidate.keyPackageId === keyPackageId &&
        candidate.keyPackageHash === keyPackageHash
    );
    if (!request) return void res.status(409).json({ error: "KeyPackage does not match the pending invite request." });
    const item = store.keyPackages.get(keyPackageId);
    if (!item) {
      if (
        invite.approvedUserId === String(req.params.userId) &&
        invite.approvedDeviceId === String(req.params.deviceId) &&
        invite.keyPackageHash === keyPackageHash
      ) {
        return void res.json({
          alreadyConsumed: true,
          keyPackageId,
          keyPackageHash,
          userId: String(req.params.userId),
          deviceId: String(req.params.deviceId)
        });
      }
      return void res.status(404).json({ error: "No KeyPackage is available.", code: "key_package_unavailable" });
    }
    if (
      item.userId !== String(req.params.userId) ||
      item.deviceId !== String(req.params.deviceId) ||
      item.keyPackageHash !== keyPackageHash
    )
      return void res.status(409).json({ error: "KeyPackage does not match the pending invite request." });
    // In-memory deletion is serialized by the JS event loop. SQLite persistence
    // receives the deletion in the same immediate save cycle.
    store.deleteKeyPackage(item.id);
    store.setInvite({
      ...invite,
      approvedUserId: item.userId,
      approvedDeviceId: item.deviceId,
      keyPackageHash: item.keyPackageHash
    });
    try {
      await saveRelayStore();
    } catch {
      store.setKeyPackage(item);
      store.setInvite(invite);
      return void res.status(503).json({ error: "Could not consume KeyPackage durably." });
    }
    res.json({ keyPackage: item });
  });
}

function hashKeyPackage(encoded: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

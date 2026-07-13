import type { Express, Response } from "express";
import { ECDH, createHash, createPublicKey, timingSafeEqual } from "node:crypto";
import { type DeviceRecord } from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import { isCanonicalPaddedBase64 } from "../opaque.js";

interface RegisterDeviceRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  scheduleStoreSave: () => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeOptionalMetadataText: (value: unknown, maxChars: number) => string | null;
  displayNameForUser: (user: AuthSession["user"]) => string;
  maxDisplayNameChars: number;
  maxDeviceIdChars: number;
  maxPublicKeyFingerprintChars: number;
  maxPublicKeyJwkChars: number;
  maxUserIdChars: number;
}

export function registerDeviceRoutes({
  app,
  store,
  getAuthSession,
  allowRead,
  allowMutation,
  scheduleStoreSave,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  displayNameForUser,
  maxDisplayNameChars,
  maxDeviceIdChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxUserIdChars
}: RegisterDeviceRoutesOptions) {
  app.post("/devices", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) {
      res.status(401).json({ error: "Sign in before registering a device identity." });
      return;
    }

    const requestedUserId = normalizeOptionalMetadataText(req.body?.userId, maxUserIdChars);
    if (requestedUserId === null) {
      res.status(400).json({ error: `userId must be up to ${maxUserIdChars} characters without control characters` });
      return;
    }
    if (session && requestedUserId && requestedUserId !== session.user.id) {
      res.status(403).json({ error: "Device user id must match the signed-in GitHub user." });
      return;
    }
    const userId = session.user.id;
    const deviceId = normalizeMetadataText(req.body?.deviceId, maxDeviceIdChars);
    const displayName = session
      ? normalizeMetadataText(displayNameForUser(session.user), maxDisplayNameChars)
      : normalizeMetadataText(req.body?.displayName, maxDisplayNameChars);
    const signaturePublicKey = normalizeMetadataText(req.body?.signaturePublicKey, maxPublicKeyJwkChars);
    const hpkePublicKey = normalizeMetadataText(req.body?.hpkePublicKey, maxPublicKeyJwkChars);
    const signatureKeyFingerprint = normalizeMetadataText(
      req.body?.signatureKeyFingerprint,
      maxPublicKeyFingerprintChars
    );
    const hpkeKeyFingerprint = normalizeMetadataText(req.body?.hpkeKeyFingerprint, maxPublicKeyFingerprintChars);
    if (!userId || !deviceId || !displayName) {
      res.status(400).json({ error: "userId, deviceId, and displayName are required" });
      return;
    }
    if (!signaturePublicKey || !hpkePublicKey || !signatureKeyFingerprint || !hpkeKeyFingerprint) {
      res.status(400).json({ error: "MLS signature and HPKE public keys and fingerprints are required" });
      return;
    }
    if (
      !validP256Spki(signaturePublicKey, maxPublicKeyJwkChars) ||
      !validP256HpkeKey(hpkePublicKey, maxPublicKeyJwkChars)
    ) {
      res.status(400).json({ error: "MLS signature and HPKE keys must be canonical P-256 public keys." });
      return;
    }

    if (
      !constantTimeTextEqual(signatureKeyFingerprint, fingerprintPublicKey(signaturePublicKey)) ||
      !constantTimeTextEqual(hpkeKeyFingerprint, fingerprintPublicKey(hpkePublicKey))
    ) {
      res.status(400).json({ error: "Public key fingerprint does not match the registered key." });
      return;
    }

    const now = new Date().toISOString();
    const existing = store.getDevice(userId, deviceId);
    if (existing && (existing.signaturePublicKey !== signaturePublicKey || existing.hpkePublicKey !== hpkePublicKey)) {
      res.status(409).json({
        error:
          "This device id is already bound to a different public key. Reset the device explicitly before replacing it."
      });
      return;
    }
    const device: DeviceRecord = {
      userId,
      deviceId,
      displayName,
      signaturePublicKey,
      signatureKeyFingerprint,
      hpkePublicKey,
      hpkeKeyFingerprint,
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now
    };
    store.setDevice(device);
    scheduleStoreSave();
    res.status(existing ? 200 : 201).json({ device });
  });

  app.get("/teams/:teamId/devices", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    if (!session) {
      res.status(401).json({ error: "Sign in before reading team device identities." });
      return;
    }

    const teamId = String(req.params.teamId ?? "");
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const members = store.getTeamMembers(teamId);
    if (!members?.has(session.user.id)) {
      res.status(403).json({ error: "Join this team before reading its device identities." });
      return;
    }
    const memberUserIds = new Set(members.keys());
    const devices = Array.from(store.devices.values())
      .filter((device) => memberUserIds.has(device.userId))
      .sort((left, right) => left.userId.localeCompare(right.userId) || left.deviceId.localeCompare(right.deviceId));
    res.json({ devices });
  });
}

export function validP256Spki(value: string, maxChars: number): boolean {
  if (!isCanonicalPaddedBase64(value, maxChars)) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

export function validP256HpkeKey(value: string, maxChars: number): boolean {
  if (!isCanonicalPaddedBase64(value, maxChars)) return false;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 65 || decoded[0] !== 4) return false;
    return ECDH.convertKey(decoded, "prime256v1", undefined, undefined, "uncompressed").length === 65;
  } catch {
    return false;
  }
}

export function fingerprintPublicKey(publicKey: string): string {
  const hex = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)?.join(":") ?? hex}`;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

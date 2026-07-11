import type { Express, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  DevicePublicKeyJwk,
  type DeviceRecord,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType
} from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";

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
    const publicKeyJwk = normalizeDevicePublicKeyJwk(req.body?.publicKeyJwk, maxPublicKeyJwkChars);
    const publicKeyFingerprint = normalizeMetadataText(req.body?.publicKeyFingerprint, maxPublicKeyFingerprintChars);
    if (!userId || !deviceId || !displayName) {
      res.status(400).json({ error: "userId, deviceId, and displayName are required" });
      return;
    }
    if (!publicKeyJwk || !publicKeyFingerprint) {
      res.status(400).json({ error: "A public key JWK and fingerprint are required" });
      return;
    }

    const canonicalFingerprint = fingerprintDevicePublicKey(publicKeyJwk);
    if (!constantTimeTextEqual(publicKeyFingerprint, canonicalFingerprint)) {
      res.status(400).json({ error: "Public key fingerprint does not match the registered public key." });
      return;
    }

    const now = new Date().toISOString();
    const existing = store.getDevice(userId, deviceId);
    if (existing && !sameDevicePublicKey(existing.publicKeyJwk, publicKeyJwk)) {
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
      publicKeyJwk,
      publicKeyFingerprint: canonicalFingerprint,
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

function fingerprintDevicePublicKey(publicKeyJwk: DevicePublicKeyJwkType): string {
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y
  });
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return hex.match(/.{1,4}/g)?.join(":") ?? hex;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sameDevicePublicKey(left: DevicePublicKeyJwkType, right: DevicePublicKeyJwkType): boolean {
  return left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y;
}

function isJsonStringifiableWithin(value: unknown, maxChars: number): boolean {
  try {
    return JSON.stringify(value).length <= maxChars;
  } catch {
    return false;
  }
}

function normalizeDevicePublicKeyJwk(value: unknown, maxPublicKeyJwkChars: number): DevicePublicKeyJwkType | null {
  if (!isJsonStringifiableWithin(value, maxPublicKeyJwkChars)) return null;
  const parsed = DevicePublicKeyJwk.safeParse(value);
  return parsed.success ? parsed.data : null;
}

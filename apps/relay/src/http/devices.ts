import type { Express, Response } from "express";
import {
  DevicePublicKeyJwk,
  type DeviceRecord,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType
} from "@multaiplayer/protocol";
import type { AuthSession } from "../state.js";

interface RegisterDeviceRoutesOptions {
  app: Express;
  devices: Map<string, DeviceRecord>;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
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
  devices,
  getAuthSession,
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

    const requestedUserId = normalizeOptionalMetadataText(req.body?.userId, maxUserIdChars);
    if (requestedUserId === null) {
      res.status(400).json({ error: `userId must be up to ${maxUserIdChars} characters without control characters` });
      return;
    }
    if (session && requestedUserId && requestedUserId !== session.user.id) {
      res.status(403).json({ error: "Device user id must match the signed-in GitHub user." });
      return;
    }
    const userId = session?.user.id ?? requestedUserId;
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

    const now = new Date().toISOString();
    const key = deviceKey(userId, deviceId);
    const existing = devices.get(key);
    const device: DeviceRecord = {
      userId,
      deviceId,
      displayName,
      publicKeyJwk,
      publicKeyFingerprint,
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now
    };
    devices.set(key, device);
    scheduleStoreSave();
    res.status(existing ? 200 : 201).json({ device });
  });
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

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

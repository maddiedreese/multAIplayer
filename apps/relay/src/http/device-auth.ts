import { sendRelayError } from "./errors.js";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { Express, Response } from "express";
import type { AuthSession, RelayStore } from "../state.js";
export function registerDeviceAuthRoutes(options: {
  app: Express;
  store: RelayStore;
  getAuthSession: (id: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
}) {
  options.app.post("/devices/:deviceId/challenge", (req, res) => {
    const s = options.getAuthSession(req.cookies?.multaiplayer_session);
    if (!options.allowMutation(s, res)) return;
    const d = String(req.params.deviceId);
    if (!s || !options.store.getDevice(s.user.id, d))
      return void sendRelayError(res, 404, "not_found", "Device not found.");
    pruneExpired(options.store);
    if (options.store.deviceChallenges.size >= 10_000 || pendingChallengeCount(options.store, s.user.id, d) >= 5) {
      return void sendRelayError(res, 429, "rate_limited", "Device challenge limit exceeded.");
    }
    const challenge = randomBytes(32).toString("base64");
    options.store.deviceChallenges.set(challenge, {
      userId: s.user.id,
      deviceId: d,
      expiresAt: Date.now() + 60_000
    });
    res.json({ challenge, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  options.app.post("/devices/:deviceId/session", (req, res) => {
    const s = options.getAuthSession(req.cookies?.multaiplayer_session);
    if (!options.allowMutation(s, res)) return;
    const d = String(req.params.deviceId);
    const challenge = String(req.body?.challenge ?? "");
    const signature = String(req.body?.signature ?? "");
    if (!isCanonicalBase64(challenge, 32) || !isCanonicalBase64(signature, undefined, 256)) {
      return void sendRelayError(res, 403, "device_auth_required", "Invalid device proof encoding.");
    }
    const pending = options.store.deviceChallenges.get(challenge);
    options.store.deviceChallenges.delete(challenge);
    const device = s && options.store.getDevice(s.user.id, d);
    if (
      !s ||
      !device ||
      !pending ||
      pending.expiresAt < Date.now() ||
      pending.userId !== s.user.id ||
      pending.deviceId !== d
    )
      return void sendRelayError(res, 403, "device_auth_required", "Invalid or expired device challenge.");
    try {
      const challengeBytes = Buffer.from(challenge, "base64");
      if (challengeBytes.length !== 32) throw new Error();
      const key = createPublicKey({
        key: Buffer.from(device.signaturePublicKey, "base64"),
        format: "der",
        type: "spki"
      });
      if (!verify("sha256", deviceAuthPayload(s.user.id, d, challengeBytes), key, Buffer.from(signature, "base64")))
        return void sendRelayError(res, 403, "device_auth_required", "Invalid device signature.");
    } catch {
      return void sendRelayError(res, 403, "device_auth_required", "Invalid device signature.");
    }
    pruneExpired(options.store);
    for (const [token, existing] of options.store.deviceSessions) {
      if (existing.userId === s.user.id && existing.deviceId === d) options.store.deviceSessions.delete(token);
    }
    const token = randomBytes(32).toString("base64url"),
      expiresAt = Date.now() + 15 * 60_000;
    options.store.deviceSessions.set(token, { token, userId: s.user.id, deviceId: d, expiresAt });
    res.json({ deviceSessionToken: token, expiresAt: new Date(expiresAt).toISOString() });
  });
}

function pruneExpired(store: RelayStore) {
  const now = Date.now();
  for (const [challenge, item] of store.deviceChallenges)
    if (item.expiresAt < now) store.deviceChallenges.delete(challenge);
  for (const [token, item] of store.deviceSessions) if (item.expiresAt < now) store.deviceSessions.delete(token);
}

function pendingChallengeCount(store: RelayStore, userId: string, deviceId: string): number {
  let count = 0;
  for (const item of store.deviceChallenges.values())
    if (item.userId === userId && item.deviceId === deviceId) count += 1;
  return count;
}

function isCanonicalBase64(value: string, exactBytes?: number, maxBytes = exactBytes): boolean {
  if (!value || value.length > 512) return false;
  const decoded = Buffer.from(value, "base64");
  return (
    decoded.toString("base64") === value &&
    (exactBytes === undefined || decoded.length === exactBytes) &&
    (maxBytes === undefined || decoded.length <= maxBytes)
  );
}
function deviceAuthPayload(userId: string, deviceId: string, challenge: Buffer) {
  const u = Buffer.from(userId),
    d = Buffer.from(deviceId),
    ub = Buffer.alloc(2),
    db = Buffer.alloc(2);
  ub.writeUInt16BE(u.length);
  db.writeUInt16BE(d.length);
  return Buffer.concat([Buffer.from("multaiplayer:relay-device-auth:v1\0", "ascii"), ub, u, db, d, challenge]);
}
export function hasDeviceSession(store: RelayStore, token: unknown, userId: string, deviceId: string) {
  if (typeof token !== "string") return false;
  const s = store.deviceSessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    store.deviceSessions.delete(token);
    return false;
  }
  return s.userId === userId && s.deviceId === deviceId;
}

export function verifyDeviceChallengeSignature(
  signaturePublicKey: string,
  userId: string,
  deviceId: string,
  challenge: Buffer,
  signature: string
): boolean {
  if (challenge.length !== 32 || !isCanonicalBase64(signature, undefined, 256)) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(signaturePublicKey, "base64"), format: "der", type: "spki" });
    return verify("sha256", deviceAuthPayload(userId, deviceId, challenge), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

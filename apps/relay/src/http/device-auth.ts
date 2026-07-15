import { sendRelayError } from "./errors.js";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { AuthSession, RelayStore } from "../state.js";
interface DeviceAuthRouteOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (id: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
}
export function registerDeviceAuthRoutes(options: DeviceAuthRouteOptions) {
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
  options.app.post("/devices/:deviceId/session", (req, res) => createDeviceSession(options, req, res));
}

function createDeviceSession(options: DeviceAuthRouteOptions, req: Request, res: Response): void {
  const session = options.getAuthSession(req.cookies?.multaiplayer_session);
  if (!options.allowMutation(session, res)) return;
  const deviceId = String(req.params.deviceId);
  const challenge = String(req.body?.challenge ?? "");
  const signature = String(req.body?.signature ?? "");
  if (!isCanonicalBase64(challenge, 32) || !isCanonicalBase64(signature, undefined, 256)) {
    return sendRelayError(res, 403, "device_auth_required", "Invalid device proof encoding.");
  }
  const pending = options.store.deviceChallenges.get(challenge);
  options.store.deviceChallenges.delete(challenge);
  const device = session && options.store.getDevice(session.user.id, deviceId);
  if (!session || !device || !validPendingChallenge(pending, session.user.id, deviceId)) {
    return sendRelayError(res, 403, "device_auth_required", "Invalid or expired device challenge.");
  }
  if (!validDeviceSignature(device.signaturePublicKey, session.user.id, deviceId, challenge, signature)) {
    return sendRelayError(res, 403, "device_auth_required", "Invalid device signature.");
  }
  issueDeviceSession(options.store, session.user.id, deviceId, res);
}

function validPendingChallenge(
  pending: RelayStore["deviceChallenges"] extends Map<string, infer T> ? T | undefined : never,
  userId: string,
  deviceId: string
): boolean {
  return Boolean(
    pending && pending.expiresAt >= Date.now() && pending.userId === userId && pending.deviceId === deviceId
  );
}

function validDeviceSignature(
  signaturePublicKey: string,
  userId: string,
  deviceId: string,
  challenge: string,
  signature: string
): boolean {
  try {
    const challengeBytes = Buffer.from(challenge, "base64");
    if (challengeBytes.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.from(signaturePublicKey, "base64"), format: "der", type: "spki" });
    return verify("sha256", deviceAuthPayload(userId, deviceId, challengeBytes), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function issueDeviceSession(store: RelayStore, userId: string, deviceId: string, res: Response): void {
  pruneExpired(store);
  for (const [token, existing] of store.deviceSessions) {
    if (existing.userId === userId && existing.deviceId === deviceId) store.deviceSessions.delete(token);
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 15 * 60_000;
  store.deviceSessions.set(token, { token, userId, deviceId, expiresAt });
  res.json({ deviceSessionToken: token, expiresAt: new Date(expiresAt).toISOString() });
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

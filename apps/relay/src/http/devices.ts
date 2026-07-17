import { sendRelayCapacityError, sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import { ECDH, createHash, createPublicKey, timingSafeEqual } from "node:crypto";
import { type DeviceRecord } from "@multaiplayer/protocol";
import { RelayStoreCapacityError, type AuthSession, type RelayStore } from "../state.js";
import { isCanonicalPaddedBase64 } from "../opaque.js";
import { acquireAccountMutationTurn, isLiveAccountSession } from "../auth/account-mutation-transaction.js";

interface RegisterDeviceRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  scheduleStoreSave: () => void;
  registeredDeviceCapPerUser: number;
  recordQuotaRejection?: (type: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeOptionalMetadataText: (value: unknown, maxChars: number) => string | null;
  displayNameForUser: (user: AuthSession["user"]) => string;
  maxDisplayNameChars: number;
  maxDeviceIdChars: number;
  maxPublicKeyFingerprintChars: number;
  maxPublicKeyJwkChars: number;
  maxUserIdChars: number;
}

export function registerDeviceRoutes(options: RegisterDeviceRoutesOptions) {
  const { app, store, getAuthSession, allowRead, allowMutation, scheduleStoreSave } = options;
  app.post("/devices", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Sign in before registering a device identity.");
      return;
    }

    const identity = normalizeDeviceRegistration(options, req.body, session, res);
    if (!identity) return;
    const {
      userId,
      deviceId,
      displayName,
      signaturePublicKey,
      hpkePublicKey,
      signatureKeyFingerprint,
      hpkeKeyFingerprint
    } = identity;

    const releaseAccountMutation = await acquireAccountMutationTurn(store, userId);
    try {
      if (!isLiveAccountSession(store, session)) {
        return void sendRelayError(
          res,
          401,
          "authentication_required",
          "Sign in before registering a device identity."
        );
      }
      const existing = store.getDevice(userId, deviceId);
      if (
        existing &&
        (existing.signaturePublicKey !== signaturePublicKey || existing.hpkePublicKey !== hpkePublicKey)
      ) {
        return void sendRelayError(
          res,
          409,
          "conflict",
          "This device id is already bound to different public keys; register a new device id instead."
        );
      }
      if (!existing && deviceCountForUser(store, userId) >= options.registeredDeviceCapPerUser) {
        options.recordQuotaRejection?.("registered_devices_per_user");
        return void sendRelayError(res, 429, "quota_exceeded", "Registered device quota exceeded.", {
          quota: {
            type: "registered_devices_per_user",
            limit: options.registeredDeviceCapPerUser,
            remaining: 0
          }
        });
      }

      const now = new Date().toISOString();
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
      let stored = false;
      try {
        store.setDevice(device);
        stored = true;
        scheduleStoreSave();
      } catch (error) {
        if (stored) {
          if (existing) store.setDevice(existing);
          else store.devices.delete(`${userId}:${deviceId}`);
        }
        if (error instanceof RelayStoreCapacityError) sendRelayCapacityError(res, error);
        else sendRelayError(res, 503, "persistence_unavailable", "Could not persist device identity.");
        return;
      }
      res.status(existing ? 200 : 201).json({ device });
    } finally {
      releaseAccountMutation();
    }
  });

  app.get("/teams/:teamId/devices", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Sign in before reading team device identities.");
      return;
    }

    const teamId = String(req.params.teamId ?? "");
    if (!store.hasTeam(teamId)) {
      sendRelayError(res, 404, "team_not_found", "Team not found");
      return;
    }
    const members = store.getTeamMembers(teamId);
    if (!members?.has(session.user.id)) {
      sendRelayError(res, 403, "forbidden", "Join this team before reading its device identities.");
      return;
    }
    const memberUserIds = new Set(members.keys());
    const devices = Array.from(store.devices.values())
      .filter((device) => memberUserIds.has(device.userId))
      .sort((left, right) => left.userId.localeCompare(right.userId) || left.deviceId.localeCompare(right.deviceId));
    res.json({ devices });
  });
}

function deviceCountForUser(store: RelayStore, userId: string): number {
  let count = 0;
  for (const device of store.devices.values()) if (device.userId === userId) count += 1;
  return count;
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

type DeviceRegistrationIdentity = Pick<
  DeviceRecord,
  | "userId"
  | "deviceId"
  | "displayName"
  | "signaturePublicKey"
  | "signatureKeyFingerprint"
  | "hpkePublicKey"
  | "hpkeKeyFingerprint"
>;

function normalizeDeviceRegistration(
  options: RegisterDeviceRoutesOptions,
  body: Record<string, unknown> | undefined,
  session: AuthSession,
  res: Response
): DeviceRegistrationIdentity | null {
  const requestedUserId = options.normalizeOptionalMetadataText(body?.userId, options.maxUserIdChars);
  if (requestedUserId === null) return deviceRegistrationError(res, "userId is invalid or exceeds its limit.");
  if (requestedUserId && requestedUserId !== session.user.id) {
    sendRelayError(res, 403, "forbidden", "Device user id must match the signed-in GitHub user.");
    return null;
  }
  const identity = normalizedDeviceIdentityFields(options, body, session);
  if (!identity) return deviceRegistrationError(res, "Device identity fields and public keys are required.");
  if (!validP256Spki(identity.signaturePublicKey, options.maxPublicKeyJwkChars)) {
    return deviceRegistrationError(res, "MLS signature and HPKE keys must be canonical P-256 public keys.");
  }
  if (!validP256HpkeKey(identity.hpkePublicKey, options.maxPublicKeyJwkChars)) {
    return deviceRegistrationError(res, "MLS signature and HPKE keys must be canonical P-256 public keys.");
  }
  if (!deviceFingerprintsMatch(identity)) {
    return deviceRegistrationError(res, "Public key fingerprint does not match the registered key.");
  }
  return identity;
}

function normalizedDeviceIdentityFields(
  options: RegisterDeviceRoutesOptions,
  body: Record<string, unknown> | undefined,
  session: AuthSession
): DeviceRegistrationIdentity | null {
  const normalize = options.normalizeMetadataText;
  const identity = {
    userId: session.user.id,
    deviceId: normalize(body?.deviceId, options.maxDeviceIdChars),
    displayName: normalize(options.displayNameForUser(session.user), options.maxDisplayNameChars),
    signaturePublicKey: normalize(body?.signaturePublicKey, options.maxPublicKeyJwkChars),
    hpkePublicKey: normalize(body?.hpkePublicKey, options.maxPublicKeyJwkChars),
    signatureKeyFingerprint: normalize(body?.signatureKeyFingerprint, options.maxPublicKeyFingerprintChars),
    hpkeKeyFingerprint: normalize(body?.hpkeKeyFingerprint, options.maxPublicKeyFingerprintChars)
  };
  return Object.values(identity).every((value) => Boolean(value)) ? (identity as DeviceRegistrationIdentity) : null;
}

function deviceFingerprintsMatch(identity: DeviceRegistrationIdentity): boolean {
  const signatureMatches = constantTimeTextEqual(
    identity.signatureKeyFingerprint,
    fingerprintPublicKey(identity.signaturePublicKey)
  );
  const hpkeMatches = constantTimeTextEqual(identity.hpkeKeyFingerprint, fingerprintPublicKey(identity.hpkePublicKey));
  return signatureMatches && hpkeMatches;
}

function deviceRegistrationError(res: Response, message: string): null {
  sendRelayError(res, 400, "invalid_request", message);
  return null;
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

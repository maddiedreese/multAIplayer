import type { NoSecretRoomInvite } from "../types";
import { canonicalAuthenticatedRecord, parseInviteCapability, sameDevicePublicKey } from "@multaiplayer/crypto";
import { DevicePublicKeyJwk } from "@multaiplayer/protocol";

const issuedKey = "multaiplayer:issued-invite-capabilities:v4";
const pinnedKey = "multaiplayer:pinned-invite-device-keys:v2";
const pendingCapabilities = new Map<string, PendingInviteCapability>();
let legacyStorageCleared = false;

export interface PendingInviteCapability extends NoSecretRoomInvite {
  inviteId: string;
  requestId: string;
  requestNonce: string;
  requesterUserId: string;
  requesterDeviceId: string;
  requesterPublicKeyFingerprint: string;
}

export type IssuedInviteCapability = Omit<NoSecretRoomInvite, "inviteCapability"> & {
  capabilityVerifier: string;
};

export async function rememberIssuedInviteCapability(inviteId: string, invite: NoSecretRoomInvite): Promise<void> {
  clearLegacyPlaintextCapabilityStorage();
  const { inviteCapability, ...metadata } = invite;
  write(issuedKey, inviteId, { ...metadata, capabilityVerifier: await capabilityVerifier(inviteCapability) });
}

export function loadIssuedInviteCapability(inviteId: string): IssuedInviteCapability | null {
  clearLegacyPlaintextCapabilityStorage();
  return read<IssuedInviteCapability>(issuedKey, inviteId);
}

export function consumeIssuedInviteCapability(inviteId: string): IssuedInviteCapability | null {
  const value = loadIssuedInviteCapability(inviteId);
  if (!value) return null;
  const all = load(issuedKey);
  delete all[inviteId];
  localStorage.setItem(issuedKey, JSON.stringify(all));
  return value;
}

export async function verifyIssuedInviteCapability(
  issued: IssuedInviteCapability,
  suppliedCapability: string
): Promise<boolean> {
  return timingSafeEqual(issued.capabilityVerifier, await capabilityVerifier(suppliedCapability));
}

/** Raw join capabilities are intentionally process-memory only and disappear on restart. */
export function rememberPendingInviteCapability(value: PendingInviteCapability): void {
  clearLegacyPlaintextCapabilityStorage();
  pendingCapabilities.set(value.requestId, structuredClone(value));
}

export function loadPendingInviteCapability(requestId: string): PendingInviteCapability | null {
  clearLegacyPlaintextCapabilityStorage();
  const value = pendingCapabilities.get(requestId);
  return value ? structuredClone(value) : null;
}

export function consumePendingInviteCapability(requestId: string): PendingInviteCapability | null {
  const value = loadPendingInviteCapability(requestId);
  pendingCapabilities.delete(requestId);
  return value;
}

export function pinInviteDeviceKey(
  roomId: string,
  userId: string,
  deviceId: string,
  fingerprint: string,
  jwk: unknown
): boolean {
  const id = `${roomId}\n${userId}\n${deviceId}`;
  const existing = read<{ fingerprint: string; jwk: unknown }>(pinnedKey, id);
  const next = { fingerprint, jwk };
  const existingKey = DevicePublicKeyJwk.safeParse(existing?.jwk);
  const nextKey = DevicePublicKeyJwk.safeParse(jwk);
  if (
    !nextKey.success ||
    (existing &&
      (existing.fingerprint !== fingerprint ||
        !existingKey.success ||
        !sameDevicePublicKey(existingKey.data, nextKey.data)))
  )
    return false;
  write(pinnedKey, id, next);
  return true;
}

export function loadPinnedInviteDeviceKey(
  roomId: string,
  userId: string,
  deviceId: string
): { fingerprint: string; jwk: unknown } | null {
  return read<{ fingerprint: string; jwk: unknown }>(pinnedKey, `${roomId}\n${userId}\n${deviceId}`);
}

async function capabilityVerifier(capability: string): Promise<string> {
  const raw = parseInviteCapability(capability);
  const context = canonicalAuthenticatedRecord("multaiplayer:invite-capability-verifier", 1, {
    capabilityBytes: Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("")
  });
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(context).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function read<T>(key: string, id: string): T | null {
  return (load(key)[id] as T | undefined) ?? null;
}

function write(key: string, id: string, value: unknown): void {
  const all = load(key);
  all[id] = value;
  localStorage.setItem(key, JSON.stringify(all));
}

function load(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    localStorage.removeItem(key);
    return {};
  }
}

function clearLegacyPlaintextCapabilityStorage(): void {
  if (legacyStorageCleared || typeof localStorage === "undefined") return;
  legacyStorageCleared = true;
  localStorage.removeItem("multaiplayer:issued-invite-capabilities:v2");
  localStorage.removeItem("multaiplayer:issued-invite-capabilities:v3");
  localStorage.removeItem("multaiplayer:pending-invite-capabilities:v2");
}

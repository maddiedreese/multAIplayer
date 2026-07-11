import { canonicalAuthenticatedRecord } from "./canonical.js";
import { base64UrlToBytes, bytesToBase64Url, toArrayBuffer } from "./encoding.js";

export interface InviteCapabilityRequestBinding {
  phase: "request";
  inviteId: string;
  teamId: string;
  roomId: string;
  keyEpoch: number;
  requestId: string;
  requestNonce: string;
  requesterUserId: string;
  requesterDeviceId: string;
  requesterPublicKeyFingerprint: string;
  hostUserId: string;
  hostDeviceId: string;
  hostPublicKeyFingerprint: string;
}

export interface InviteCapabilityResponseBinding extends Omit<InviteCapabilityRequestBinding, "phase"> {
  phase: "response";
  status: "approved" | "denied";
  decidedAt: string;
}

export type InviteCapabilityBinding = InviteCapabilityRequestBinding | InviteCapabilityResponseBinding;

function bindingData(binding: InviteCapabilityBinding): Uint8Array {
  const common = {
    phase: binding.phase,
    inviteId: binding.inviteId,
    teamId: binding.teamId,
    roomId: binding.roomId,
    keyEpoch: binding.keyEpoch,
    requestId: binding.requestId,
    requestNonce: binding.requestNonce,
    requesterUserId: binding.requesterUserId,
    requesterDeviceId: binding.requesterDeviceId,
    requesterPublicKeyFingerprint: binding.requesterPublicKeyFingerprint,
    hostUserId: binding.hostUserId,
    hostDeviceId: binding.hostDeviceId,
    hostPublicKeyFingerprint: binding.hostPublicKeyFingerprint
  };
  return canonicalAuthenticatedRecord(
    "multaiplayer:invite-capability-mac",
    1,
    binding.phase === "response" ? { ...common, status: binding.status, decidedAt: binding.decidedAt } : common
  );
}

export function createInviteCapability(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function parseInviteCapability(capability: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new Error("Invite capability must use canonical base64url");
  const raw = base64UrlToBytes(capability);
  if (raw.byteLength !== 32 || bytesToBase64Url(raw) !== capability) {
    throw new Error("Invite capability must be canonical 256-bit base64url");
  }
  return raw;
}

export async function computeInviteCapabilityMac(
  capability: string,
  binding: InviteCapabilityBinding
): Promise<string> {
  const raw = parseInviteCapability(capability);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(bindingData(binding)));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyInviteCapabilityMac(
  capability: string,
  binding: InviteCapabilityBinding,
  mac: string
): Promise<boolean> {
  try {
    const raw = parseInviteCapability(capability);
    const signature = base64UrlToBytes(mac);
    if (signature.byteLength !== 32) return false;
    const key = await crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify"
    ]);
    return crypto.subtle.verify("HMAC", key, toArrayBuffer(signature), toArrayBuffer(bindingData(binding)));
  } catch {
    return false;
  }
}

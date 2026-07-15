import type { NoSecretRoomInvite } from "../../types";
import { InviteJoinError } from "./inviteJoinError";

export function encodeNoSecretRoomInvite(invite: NoSecretRoomInvite): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
}

export function decodeNoSecretRoomInvite(value: string): NoSecretRoomInvite {
  let decoded: Partial<NoSecretRoomInvite>;
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<NoSecretRoomInvite>;
  } catch {
    throw new InviteJoinError("invalid_invite", "The protected invite payload is invalid.");
  }
  if (
    decoded.version !== 4 ||
    typeof decoded.teamId !== "string" ||
    typeof decoded.roomId !== "string" ||
    typeof decoded.roomName !== "string" ||
    typeof decoded.capabilityHandle !== "string" ||
    !decoded.capabilityHandle ||
    typeof decoded.capabilityUrlValue !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(decoded.capabilityUrlValue) ||
    typeof decoded.expiresAt !== "string" ||
    Number.isNaN(Date.parse(decoded.expiresAt)) ||
    typeof decoded.hostUserId !== "string" ||
    typeof decoded.hostDeviceId !== "string" ||
    typeof decoded.hostHpkePublicKey !== "string" ||
    !decoded.hostHpkePublicKey ||
    typeof decoded.hostHpkeKeyFingerprint !== "string"
  ) {
    throw new InviteJoinError("invalid_invite", "No-secret invite is missing required metadata");
  }
  return {
    version: decoded.version,
    teamId: decoded.teamId,
    roomId: decoded.roomId,
    roomName: decoded.roomName,
    capabilityHandle: decoded.capabilityHandle,
    capabilityUrlValue: decoded.capabilityUrlValue,
    expiresAt: decoded.expiresAt,
    hostUserId: decoded.hostUserId,
    hostDeviceId: decoded.hostDeviceId,
    hostHpkePublicKey: decoded.hostHpkePublicKey,
    hostHpkeKeyFingerprint: decoded.hostHpkeKeyFingerprint
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

import { DevicePublicKeyJwk, type DevicePublicKeyJwk as DevicePublicKeyJwkType } from "@multaiplayer/protocol";
import type { NoSecretRoomInvite } from "../types";

export function jsonWebKeyToDevicePublicKeyJwk(key: JsonWebKey): DevicePublicKeyJwkType {
  return DevicePublicKeyJwk.parse(JSON.parse(JSON.stringify(key)));
}

export function encodeNoSecretRoomInvite(invite: NoSecretRoomInvite): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
}

export function decodeNoSecretRoomInvite(value: string): NoSecretRoomInvite {
  const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<NoSecretRoomInvite>;
  if (
    decoded.version !== 1 ||
    typeof decoded.teamId !== "string" ||
    typeof decoded.roomId !== "string" ||
    typeof decoded.roomName !== "string" ||
    typeof decoded.hostDeviceId !== "string" ||
    !DevicePublicKeyJwk.safeParse(decoded.hostPublicKeyJwk).success ||
    typeof decoded.hostPublicKeyFingerprint !== "string"
  ) {
    throw new Error("No-secret invite is missing required metadata");
  }
  const hostPublicKeyJwk = DevicePublicKeyJwk.parse(decoded.hostPublicKeyJwk);
  return {
    version: decoded.version,
    teamId: decoded.teamId,
    roomId: decoded.roomId,
    roomName: decoded.roomName,
    hostDeviceId: decoded.hostDeviceId,
    hostPublicKeyJwk,
    hostPublicKeyFingerprint: decoded.hostPublicKeyFingerprint
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

import type { DevicePublicKeyJwk as DevicePublicKeyJwkType } from "@multaiplayer/protocol";

export interface RoomSecret {
  algorithm: "AES-GCM-256";
  rawKey: string;
}

export interface DeviceKeyAgreementIdentity {
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  publicKeyJwk: DevicePublicKeyJwkType;
  privateKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
  createdAt: string;
}

export type DevicePrivateKey = JsonWebKey | CryptoKey;

export interface WrappedRoomSecret {
  version: 1 | 2;
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  ephemeralPublicKeyJwk: DevicePublicKeyJwkType;
  nonce: string;
  ciphertext: string;
}

export interface DeviceCryptoContext {
  purpose: "invite-request" | "invite-response" | "room-key-rotation";
  teamId: string;
  roomId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  operationId?: string;
  requestId?: string;
  requestNonce?: string;
  keyEpoch?: number;
  previousEpoch?: number;
  newEpoch?: number;
}

export interface LocalCryptoContext {
  purpose: "room-history" | "room-secret-backup";
  roomId: string;
  keyEpoch: number;
  savedAt: string;
}

export interface AttachmentCryptoContext {
  teamId: string;
  roomId: string;
  name: string;
  type: string;
  size: number;
}

import { z } from "zod";
import {
  maxCiphertextNonceChars,
  maxCiphertextPayloadChars,
  maxRoomSecretRawKeyChars,
  maxWrappedCiphertextChars,
  publicKeyCoordinatePattern
} from "./limits-ids.js";

export const DevicePublicKeyJwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1).max(128).regex(publicKeyCoordinatePattern),
  y: z.string().min(1).max(128).regex(publicKeyCoordinatePattern)
}).passthrough().refine((jwk) => !("d" in jwk), {
  message: "Device public key JWK must not include private key material"
});

export const CiphertextPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxCiphertextPayloadChars)
});

export const DeviceSealedPayload = z.object({
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const EncryptedPayload = z.union([CiphertextPayload, DeviceSealedPayload]);

export const WrappedRoomSecretPayload = z.object({
  version: z.literal(1),
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const RoomSecretPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  rawKey: z.string().min(1).max(maxRoomSecretRawKeyChars)
});

export type DevicePublicKeyJwk = z.infer<typeof DevicePublicKeyJwk>;
export type CiphertextPayload = z.infer<typeof CiphertextPayload>;
export type DeviceSealedPayload = z.infer<typeof DeviceSealedPayload>;
export type EncryptedPayload = z.infer<typeof EncryptedPayload>;
export type WrappedRoomSecretPayload = z.infer<typeof WrappedRoomSecretPayload>;
export type RoomSecretPayload = z.infer<typeof RoomSecretPayload>;

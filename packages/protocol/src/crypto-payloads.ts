import { z } from "zod";
import {
  maxCiphertextNonceChars,
  maxCiphertextPayloadChars,
  maxRoomSecretRawKeyChars,
  maxWrappedCiphertextChars,
  publicKeyCoordinatePattern
} from "./limits-ids.js";

export const DevicePublicKeyJwk = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1).max(128).regex(publicKeyCoordinatePattern),
    y: z.string().min(1).max(128).regex(publicKeyCoordinatePattern)
  })
  .passthrough()
  .refine((jwk) => !("d" in jwk), {
    message: "Device public key JWK must not include private key material"
  });

/** Full SHA-256 device-key fingerprint: sixteen colon-delimited 16-bit groups. */
export const PublicKeyFingerprint = z.string().regex(/^sha256:[a-f0-9]{4}(?::[a-f0-9]{4}){15}$/);

const CiphertextPayloadFields = {
  algorithm: z.literal("AES-GCM-256"),
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxCiphertextPayloadChars)
};
export const CiphertextPayload = z.discriminatedUnion("version", [
  z.object({ version: z.literal(2), ...CiphertextPayloadFields }),
  z.object({ version: z.literal(3), ...CiphertextPayloadFields })
]);

const DeviceSealedPayloadFields = {
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
};
export const DeviceSealedPayload = z.union([
  z.object({ version: z.literal(3), ...DeviceSealedPayloadFields }),
  z
    .object(DeviceSealedPayloadFields)
    .passthrough()
    .refine((payload) => !("version" in payload), { message: "Legacy device-sealed payload must be unversioned" })
]);

export const EncryptedPayload = z.union([CiphertextPayload, DeviceSealedPayload]);

export const WrappedRoomSecretPayload = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const AuthenticatedWrappedRoomSecretPayload = z.object({
  version: z.union([z.literal(2), z.literal(3)]),
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  senderPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const RoomSecretPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  rawKey: z.string().min(1).max(maxRoomSecretRawKeyChars)
});

export type DevicePublicKeyJwk = z.infer<typeof DevicePublicKeyJwk>;
export type PublicKeyFingerprint = z.infer<typeof PublicKeyFingerprint>;
export type CiphertextPayload = z.infer<typeof CiphertextPayload>;
export type DeviceSealedPayload = z.infer<typeof DeviceSealedPayload>;
export type EncryptedPayload = z.infer<typeof EncryptedPayload>;
export type WrappedRoomSecretPayload = z.infer<typeof WrappedRoomSecretPayload>;
export type AuthenticatedWrappedRoomSecretPayload = z.infer<typeof AuthenticatedWrappedRoomSecretPayload>;
export type RoomSecretPayload = z.infer<typeof RoomSecretPayload>;

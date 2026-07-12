import type { CiphertextPayload, RoomEnvelopeMetadata as RoomEnvelopeMetadataType } from "@multaiplayer/protocol";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "./encoding.js";
import { importRoomKey } from "./key-material.js";
import {
  attachmentAdditionalData,
  legacyAttachmentAdditionalData,
  legacyLocalAdditionalData,
  legacyRoomEnvelopeAdditionalData,
  localAdditionalData,
  roomEnvelopeAdditionalData
} from "./additional-data.js";
import type { AttachmentCryptoContext, LocalCryptoContext, RoomSecret } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// mutation-policy:start envelope-wrappers
export async function encryptJson(
  value: unknown,
  secret: RoomSecret,
  metadata: RoomEnvelopeMetadataType
): Promise<CiphertextPayload> {
  return encryptJsonWithAdditionalData(value, secret, roomEnvelopeAdditionalData(metadata));
}

export async function decryptJson<T>(
  payload: CiphertextPayload,
  secret: RoomSecret,
  metadata: RoomEnvelopeMetadataType
): Promise<T> {
  return decryptJsonWithAdditionalData(
    payload,
    secret,
    roomEnvelopeAdditionalData(metadata),
    legacyRoomEnvelopeAdditionalData(metadata)
  );
}

export async function encryptLocalJson(
  value: unknown,
  secret: RoomSecret,
  context: LocalCryptoContext
): Promise<CiphertextPayload> {
  return encryptJsonWithAdditionalData(value, secret, localAdditionalData(context));
}

export async function decryptLocalJson<T>(
  payload: CiphertextPayload,
  secret: RoomSecret,
  context: LocalCryptoContext
): Promise<T> {
  return decryptJsonWithAdditionalData(
    payload,
    secret,
    localAdditionalData(context),
    legacyLocalAdditionalData(context)
  );
}
// mutation-policy:end envelope-wrappers

// mutation-policy:start attachment-wrapper
export async function encryptAttachmentJson(value: unknown, secret: RoomSecret, context: AttachmentCryptoContext) {
  return encryptJsonWithAdditionalData(value, secret, attachmentAdditionalData(context));
}

export async function decryptAttachmentJson<T>(
  payload: CiphertextPayload,
  secret: RoomSecret,
  context: AttachmentCryptoContext
) {
  return decryptJsonWithAdditionalData<T>(
    payload,
    secret,
    attachmentAdditionalData(context),
    legacyAttachmentAdditionalData(context)
  );
}
// mutation-policy:end attachment-wrapper

// mutation-policy:start payload-core
async function encryptJsonWithAdditionalData(
  value: unknown,
  secret: RoomSecret,
  additionalData: Uint8Array
): Promise<CiphertextPayload> {
  const key = await importRoomKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(additionalData) },
    key,
    encoder.encode(JSON.stringify(value))
  );
  return {
    version: 3,
    algorithm: "AES-GCM-256",
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptJsonWithAdditionalData<T>(
  payload: CiphertextPayload,
  secret: RoomSecret,
  additionalData: Uint8Array,
  legacyAdditionalData?: Uint8Array
): Promise<T> {
  if (payload.version !== 2 && payload.version !== 3) throw new Error("Unsupported ciphertext version");
  if (payload.algorithm !== "AES-GCM-256") throw new Error("Unsupported ciphertext algorithm");
  const key = await importRoomKey(secret);
  const plaintext = await decryptWithAdditionalData(
    key,
    base64ToBytes(payload.nonce),
    base64ToBytes(payload.ciphertext),
    payload.version === 3 ? additionalData : (legacyAdditionalData ?? additionalData)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function decryptWithAdditionalData(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  additionalData: Uint8Array,
  legacyAdditionalData?: Uint8Array
): Promise<ArrayBuffer> {
  const decrypt = (aad: Uint8Array) =>
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
      key,
      toArrayBuffer(ciphertext)
    );
  try {
    return await decrypt(additionalData);
  } catch (error) {
    if (!legacyAdditionalData) throw error;
    return decrypt(legacyAdditionalData);
  }
}
// mutation-policy:end payload-core

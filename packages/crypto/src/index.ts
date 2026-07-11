import {
  DevicePublicKeyJwk,
  RoomEnvelopeMetadata,
  type AuthenticatedWrappedRoomSecretPayload,
  type CiphertextPayload,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type DeviceSealedPayload,
  type RoomEnvelopeMetadata as RoomEnvelopeMetadataType
} from "@multaiplayer/protocol";
import { canonicalAuthenticatedRecord } from "./canonical.js";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "./encoding.js";
export { canonicalAuthenticatedRecord, type CanonicalAuthenticatedValue } from "./canonical.js";
export { base64ToBytes, bytesToBase64 } from "./encoding.js";
export {
  computeInviteCapabilityMac,
  createInviteCapability,
  parseInviteCapability,
  verifyInviteCapabilityMac,
  type InviteCapabilityBinding,
  type InviteCapabilityRequestBinding,
  type InviteCapabilityResponseBinding
} from "./inviteCapability.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function wrapRoomSecretAuthenticatedForDevice(
  secret: RoomSecret,
  senderIdentity: { publicKeyJwk: JsonWebKey; privateKeyJwk: DevicePrivateKey },
  recipientPublicKeyJwk: JsonWebKey,
  context: DeviceCryptoContext
): Promise<AuthenticatedWrappedRoomSecretPayload> {
  validateRoomSecret(secret);
  const senderPrivateKey = await importEcdhPrivateKey(senderIdentity.privateKeyJwk);
  const recipientPublicKey = await importEcdhPublicKey(recipientPublicKeyJwk);
  const aad = authenticatedWrapAdditionalData(context);
  const wrappingKey = await deriveAuthenticatedWrappingKey(senderPrivateKey, recipientPublicKey, aad);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
    wrappingKey,
    encoder.encode(JSON.stringify(secret))
  );
  return {
    version: 3,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    senderPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(senderIdentity.publicKeyJwk),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function unwrapRoomSecretAuthenticatedFromDevice(
  payload: AuthenticatedWrappedRoomSecretPayload,
  recipientPrivateKeyJwk: DevicePrivateKey,
  expectedSenderPublicKeyJwk: JsonWebKey,
  context: DeviceCryptoContext
): Promise<RoomSecret> {
  const actualSender = jsonWebKeyToDevicePublicKeyJwk(payload.senderPublicKeyJwk);
  const expectedSender = jsonWebKeyToDevicePublicKeyJwk(expectedSenderPublicKeyJwk);
  if (!sameDevicePublicKey(actualSender, expectedSender)) {
    throw new Error("Authenticated room-secret sender key does not match the pinned host key");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const senderPublicKey = await importEcdhPublicKey(actualSender);
  // There is no authenticated room-generation marker that could safely scope a v2 migration.
  // Fail closed instead of letting received ciphertext select the legacy AAD representation.
  if (payload.version !== 3) throw new Error("Unsupported authenticated room-secret wrap version");
  const aad = authenticatedWrapAdditionalData(context);
  const wrappingKey = await deriveAuthenticatedWrappingKey(recipientPrivateKey, senderPublicKey, aad);
  const plaintext = await decryptWithAdditionalData(
    wrappingKey,
    base64ToBytes(payload.nonce),
    base64ToBytes(payload.ciphertext),
    aad
  );
  const secret = JSON.parse(decoder.decode(plaintext)) as RoomSecret;
  validateRoomSecret(secret);
  return secret;
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

export async function createRoomSecret(): Promise<RoomSecret> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return {
    algorithm: "AES-GCM-256",
    rawKey: bytesToBase64(new Uint8Array(raw))
  };
}

export async function createDeviceKeyAgreementIdentity(): Promise<DeviceKeyAgreementIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey"]
  );
  const publicKeyJwk = jsonWebKeyToDevicePublicKeyJwk(await crypto.subtle.exportKey("jwk", keyPair.publicKey));
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    publicKeyJwk,
    privateKeyJwk,
    publicKeyFingerprint: await fingerprintPublicKey(publicKeyJwk),
    createdAt: new Date().toISOString()
  };
}

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
  const key = await importRoomKey(secret);
  const plaintext = await decryptWithAdditionalData(
    key,
    base64ToBytes(payload.nonce),
    base64ToBytes(payload.ciphertext),
    payload.version === 3 ? additionalData : (legacyAdditionalData ?? additionalData)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

async function decryptWithAdditionalData(
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

export async function sealJsonToDevice(
  value: unknown,
  recipientPublicKeyJwk: JsonWebKey,
  context: DeviceCryptoContext
): Promise<DeviceSealedPayload> {
  const recipientPublicKey = await importEcdhPublicKey(recipientPublicKeyJwk);
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey"]
  );
  const sealingKey = await deriveWrappingKey(ephemeralKeyPair.privateKey, recipientPublicKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(deviceSealAdditionalData(context))
    },
    sealingKey,
    encoder.encode(JSON.stringify(value))
  );
  return {
    version: 3,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(
      await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey)
    ),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function openDeviceSealedJson<T>(
  payload: DeviceSealedPayload,
  recipientPrivateKeyJwk: DevicePrivateKey,
  context: DeviceCryptoContext
): Promise<T> {
  if (payload.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    throw new Error("Unsupported device-sealed payload");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importEcdhPublicKey(payload.ephemeralPublicKeyJwk);
  const sealingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublicKey);
  const canonical = "version" in payload && payload.version === 3;
  const plaintext = await decryptWithAdditionalData(
    sealingKey,
    base64ToBytes(payload.nonce),
    base64ToBytes(payload.ciphertext),
    canonical
      ? deviceSealAdditionalData(context)
      : legacyCryptoContextAdditionalData("multaiplayer:device-sealed-json:v2", context)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function wrapRoomSecretForDevice(
  secret: RoomSecret,
  recipientPublicKeyJwk: JsonWebKey,
  context: DeviceCryptoContext
): Promise<WrappedRoomSecret> {
  validateRoomSecret(secret);
  const recipientPublicKey = await importEcdhPublicKey(recipientPublicKeyJwk);
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey"]
  );
  const wrappingKey = await deriveWrappingKey(ephemeralKeyPair.privateKey, recipientPublicKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(wrapAdditionalData(context))
    },
    wrappingKey,
    encoder.encode(JSON.stringify(secret))
  );
  return {
    version: 2,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(
      await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey)
    ),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function unwrapRoomSecretForDevice(
  payload: WrappedRoomSecret,
  recipientPrivateKeyJwk: DevicePrivateKey,
  context: DeviceCryptoContext
): Promise<RoomSecret> {
  if ((payload.version !== 1 && payload.version !== 2) || payload.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    throw new Error("Unsupported wrapped room secret");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importEcdhPublicKey(payload.ephemeralPublicKeyJwk);
  const wrappingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublicKey);
  const plaintext = await decryptWithAdditionalData(
    wrappingKey,
    base64ToBytes(payload.nonce),
    base64ToBytes(payload.ciphertext),
    payload.version === 2
      ? wrapAdditionalData(context)
      : legacyCryptoContextAdditionalData("multaiplayer:room-secret-wrap:v2", context)
  );
  const secret = JSON.parse(decoder.decode(plaintext)) as RoomSecret;
  validateRoomSecret(secret);
  return secret;
}

async function importRoomKey(secret: RoomSecret): Promise<CryptoKey> {
  validateRoomSecret(secret);
  return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(secret.rawKey)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

export function validateRoomSecret(secret: unknown): asserts secret is RoomSecret {
  if (!secret || typeof secret !== "object") {
    throw new Error("Room secret must be an object");
  }
  const value = secret as Partial<RoomSecret>;
  if (value.algorithm !== "AES-GCM-256") {
    throw new Error(`Unsupported room secret algorithm: ${String(value.algorithm)}`);
  }
  let rawKeyBytes: Uint8Array | null = null;
  if (typeof value.rawKey === "string") {
    try {
      rawKeyBytes = base64ToBytes(value.rawKey);
    } catch {
      rawKeyBytes = null;
    }
  }
  if (rawKeyBytes?.byteLength !== 32) {
    throw new Error("Room key must be 256 bits");
  }
}

async function importEcdhPublicKey(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    []
  );
}

async function importEcdhPrivateKey(privateKeyJwk: DevicePrivateKey): Promise<CryptoKey> {
  if (privateKeyJwk instanceof CryptoKey) {
    if (
      privateKeyJwk.type !== "private" ||
      privateKeyJwk.algorithm.name !== "ECDH" ||
      (privateKeyJwk.algorithm as EcKeyAlgorithm).namedCurve !== "P-256"
    ) {
      throw new Error("Device private key must be a P-256 ECDH private key");
    }
    return privateKeyJwk;
  }
  const importable = { ...privateKeyJwk };
  delete importable.key_ops;
  delete importable.use;
  return crypto.subtle.importKey(
    "jwk",
    importable,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    ["deriveKey", "deriveBits"]
  );
}

/** Imports persisted device material into a non-extractable runtime handle. */
export async function importDevicePrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return importEcdhPrivateKey(privateKeyJwk);
}

async function deriveAuthenticatedWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, aad: Uint8Array) {
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const salt = await crypto.subtle.digest("SHA-256", toArrayBuffer(aad));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("multaiplayer:authenticated-room-secret-wrap:v2") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: publicKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function wrapAdditionalData(context: DeviceCryptoContext): Uint8Array {
  return cryptoContextAdditionalData("multaiplayer:room-secret-wrap:v2", context);
}

function deviceSealAdditionalData(context: DeviceCryptoContext): Uint8Array {
  return cryptoContextAdditionalData("multaiplayer:device-sealed-json:v2", context);
}

function cryptoContextAdditionalData(domain: string, context: DeviceCryptoContext): Uint8Array {
  const values = [
    context.purpose,
    context.teamId,
    context.roomId,
    context.senderUserId,
    context.senderDeviceId,
    context.recipientDeviceId
  ];
  if (values.some((value) => !value)) throw new Error("Device crypto context fields must be non-empty");
  return canonicalAuthenticatedRecord(domain, 1, {
    purpose: context.purpose,
    teamId: context.teamId,
    roomId: context.roomId,
    senderUserId: context.senderUserId,
    senderDeviceId: context.senderDeviceId,
    recipientDeviceId: context.recipientDeviceId,
    operationId: context.operationId ?? null,
    requestId: context.requestId ?? null,
    requestNonce: context.requestNonce ?? null,
    keyEpoch: context.keyEpoch ?? null,
    previousEpoch: context.previousEpoch ?? null,
    newEpoch: context.newEpoch ?? null
  });
}

function legacyCryptoContextAdditionalData(domain: string, context: DeviceCryptoContext): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      domain,
      purpose: context.purpose,
      teamId: context.teamId,
      roomId: context.roomId,
      senderUserId: context.senderUserId,
      senderDeviceId: context.senderDeviceId,
      recipientDeviceId: context.recipientDeviceId,
      operationId: context.operationId ?? null,
      requestId: context.requestId ?? null,
      requestNonce: context.requestNonce ?? null,
      keyEpoch: context.keyEpoch ?? null,
      previousEpoch: context.previousEpoch ?? null,
      newEpoch: context.newEpoch ?? null
    })
  );
}

function authenticatedWrapAdditionalData(context: DeviceCryptoContext): Uint8Array {
  if (context.purpose === "invite-response") {
    if (!context.requestId || !context.requestNonce || context.keyEpoch == null || context.keyEpoch < 1) {
      throw new Error("Invite response wrap requires a request id, nonce, and key epoch");
    }
  } else if (context.purpose === "room-key-rotation") {
    if (!context.operationId) throw new Error("Rotation wrap requires an operationId");
    if (
      context.previousEpoch == null ||
      context.newEpoch !== context.previousEpoch + 1 ||
      context.keyEpoch !== context.previousEpoch
    ) {
      throw new Error("Rotation wrap requires a valid bound epoch transition");
    }
  } else {
    throw new Error("Authenticated room-secret wraps require an invite response or room-key rotation context");
  }
  return cryptoContextAdditionalData("multaiplayer:authenticated-room-secret-wrap:v2", context);
}

export function sameDevicePublicKey(left: JsonWebKey, right: JsonWebKey): boolean {
  const leftKey = DevicePublicKeyJwk.safeParse(left);
  const rightKey = DevicePublicKeyJwk.safeParse(right);
  return (
    leftKey.success &&
    rightKey.success &&
    leftKey.data.kty === rightKey.data.kty &&
    leftKey.data.crv === rightKey.data.crv &&
    leftKey.data.x === rightKey.data.x &&
    leftKey.data.y === rightKey.data.y
  );
}

/** Deterministic, versioned AES-GCM AAD. Keep field order stable as part of the wire protocol. */
export function roomEnvelopeAdditionalData(metadata: RoomEnvelopeMetadataType): Uint8Array {
  const value = RoomEnvelopeMetadata.parse(metadata);
  return canonicalAuthenticatedRecord("multaiplayer:room-envelope:v2", 1, value);
}

function legacyRoomEnvelopeAdditionalData(metadata: RoomEnvelopeMetadataType): Uint8Array {
  const value = RoomEnvelopeMetadata.parse(metadata);
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:room-envelope:v2", ...value }));
}

function localAdditionalData(context: LocalCryptoContext): Uint8Array {
  if (!context.roomId || !context.savedAt || !Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1) {
    throw new Error("Invalid local crypto context");
  }
  return canonicalAuthenticatedRecord("multaiplayer:local-json:v2", 1, {
    purpose: context.purpose,
    roomId: context.roomId,
    keyEpoch: context.keyEpoch,
    savedAt: context.savedAt
  });
}

function legacyLocalAdditionalData(context: LocalCryptoContext): Uint8Array {
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:local-json:v2", ...context }));
}

function attachmentAdditionalData(context: AttachmentCryptoContext): Uint8Array {
  if (
    !context.teamId ||
    !context.roomId ||
    !context.name ||
    !context.type ||
    !Number.isSafeInteger(context.size) ||
    context.size < 0
  ) {
    throw new Error("Invalid attachment crypto context");
  }
  return canonicalAuthenticatedRecord("multaiplayer:attachment:v2", 1, {
    teamId: context.teamId,
    roomId: context.roomId,
    name: context.name,
    type: context.type,
    size: context.size
  });
}

function legacyAttachmentAdditionalData(context: AttachmentCryptoContext): Uint8Array {
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:attachment:v2", ...context }));
}

function jsonWebKeyToDevicePublicKeyJwk(key: JsonWebKey): DevicePublicKeyJwkType {
  const parsed = DevicePublicKeyJwk.safeParse(JSON.parse(JSON.stringify(key)));
  if (!parsed.success) {
    throw new Error("Expected exported ECDH public key material");
  }
  return parsed.data;
}

export async function fingerprintPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  const key = DevicePublicKeyJwk.parse(publicKeyJwk);
  // Preserve the deployed fingerprint preimage exactly while avoiding object-order semantics.
  const bytes = encoder.encode(`{"crv":"${key.crv}","kty":"${key.kty}","x":"${key.x}","y":"${key.y}"}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "sha256:" +
    (Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .match(/.{1,4}/g)
      ?.join(":") ?? "")
  );
}

import {
  DevicePublicKeyJwk,
  type CiphertextPayload,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type DeviceSealedPayload
} from "@multaiplayer/protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface RoomSecret {
  algorithm: "AES-GCM-256";
  rawKey: string;
}

export interface RoomInviteSecret {
  version: 1;
  teamId: string;
  roomId: string;
  roomName: string;
  secret: RoomSecret;
}

export interface DeviceKeyAgreementIdentity {
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  publicKeyJwk: DevicePublicKeyJwkType;
  privateKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
  createdAt: string;
}

export interface WrappedRoomSecret {
  version: 1;
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  ephemeralPublicKeyJwk: DevicePublicKeyJwkType;
  nonce: string;
  ciphertext: string;
}

export async function createRoomSecret(): Promise<RoomSecret> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
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

export function encodeRoomInviteSecret(invite: RoomInviteSecret): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(invite)));
}

export function decodeRoomInviteSecret(value: string): RoomInviteSecret {
  const decoded = JSON.parse(decoder.decode(base64UrlToBytes(value))) as RoomInviteSecret;
  if (decoded.version !== 1) {
    throw new Error("Unsupported invite version");
  }
  if (!decoded.teamId || !decoded.roomId || !decoded.roomName) {
    throw new Error("Invite is missing room metadata");
  }
  if (decoded.secret.algorithm !== "AES-GCM-256") {
    throw new Error(`Unsupported room secret algorithm: ${decoded.secret.algorithm}`);
  }
  const rawKeyBytes = base64ToBytes(decoded.secret.rawKey);
  if (rawKeyBytes.byteLength !== 32) {
    throw new Error("Invite room key must be 256 bits");
  }
  return decoded;
}

export async function encryptJson(value: unknown, secret: RoomSecret): Promise<CiphertextPayload> {
  const key = await importRoomKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(plaintext)
  );
  return {
    algorithm: "AES-GCM-256",
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptJson<T>(payload: CiphertextPayload, secret: RoomSecret): Promise<T> {
  const key = await importRoomKey(secret);
  const nonce = base64ToBytes(payload.nonce);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function sealJsonToDevice(value: unknown, recipientPublicKeyJwk: JsonWebKey): Promise<DeviceSealedPayload> {
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
      additionalData: toArrayBuffer(deviceSealAdditionalData())
    },
    sealingKey,
    encoder.encode(JSON.stringify(value))
  );
  return {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey)),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function openDeviceSealedJson<T>(payload: DeviceSealedPayload, recipientPrivateKeyJwk: JsonWebKey): Promise<T> {
  if (payload.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    throw new Error("Unsupported device-sealed payload");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importEcdhPublicKey(payload.ephemeralPublicKeyJwk);
  const sealingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublicKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(payload.nonce)),
      additionalData: toArrayBuffer(deviceSealAdditionalData())
    },
    sealingKey,
    toArrayBuffer(base64ToBytes(payload.ciphertext))
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function wrapRoomSecretForDevice(secret: RoomSecret, recipientPublicKeyJwk: JsonWebKey): Promise<WrappedRoomSecret> {
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
      additionalData: toArrayBuffer(wrapAdditionalData())
    },
    wrappingKey,
    encoder.encode(JSON.stringify(secret))
  );
  return {
    version: 1,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey)),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function unwrapRoomSecretForDevice(payload: WrappedRoomSecret, recipientPrivateKeyJwk: JsonWebKey): Promise<RoomSecret> {
  if (payload.version !== 1 || payload.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    throw new Error("Unsupported wrapped room secret");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importEcdhPublicKey(payload.ephemeralPublicKeyJwk);
  const wrappingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublicKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(payload.nonce)),
      additionalData: toArrayBuffer(wrapAdditionalData())
    },
    wrappingKey,
    toArrayBuffer(base64ToBytes(payload.ciphertext))
  );
  const secret = JSON.parse(decoder.decode(plaintext)) as RoomSecret;
  validateRoomSecret(secret);
  return secret;
}

async function importRoomKey(secret: RoomSecret): Promise<CryptoKey> {
  validateRoomSecret(secret);
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64ToBytes(secret.rawKey)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
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

async function importEcdhPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    ["deriveKey"]
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

function wrapAdditionalData(): Uint8Array {
  return encoder.encode("multaiplayer:room-secret-wrap:v1");
}

function deviceSealAdditionalData(): Uint8Array {
  return encoder.encode("multaiplayer:device-sealed-json:v1");
}

function jsonWebKeyToDevicePublicKeyJwk(key: JsonWebKey): DevicePublicKeyJwkType {
  const parsed = DevicePublicKeyJwk.safeParse(JSON.parse(JSON.stringify(key)));
  if (!parsed.success) {
    throw new Error("Expected exported ECDH public key material");
  }
  return parsed.data;
}

export async function fingerprintPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y
  });
  const bytes = encoder.encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)
    ?.slice(0, 8)
    .join(":") ?? "";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return base64ToBytes(padded);
}

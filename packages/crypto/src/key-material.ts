import { DevicePublicKeyJwk, type DevicePublicKeyJwk as DevicePublicKeyJwkType } from "@multaiplayer/protocol";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "./encoding.js";
import type { DeviceKeyAgreementIdentity, DevicePrivateKey, RoomSecret } from "./types.js";

const encoder = new TextEncoder();

// mutation-policy:start secret-and-identity-creation
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
// mutation-policy:end secret-and-identity-creation

// mutation-policy:start room-secret-validation
export async function importRoomKey(secret: RoomSecret): Promise<CryptoKey> {
  validateRoomSecret(secret);
  // Stryker disable next-line BooleanLiteral: internal key handle is never returned and extractability is unobservable
  return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(secret.rawKey)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

export function validateRoomSecret(secret: unknown): asserts secret is RoomSecret {
  if (secret === null || typeof secret !== "object" || Array.isArray(secret)) {
    throw new Error("Room secret must be an object");
  }
  const value = secret as Partial<RoomSecret>;
  if (value.algorithm !== "AES-GCM-256") {
    throw new Error(`Unsupported room secret algorithm: ${String(value.algorithm)}`);
  }
  if (typeof value.rawKey !== "string") {
    throw new Error("Room key must be 256 bits");
  }
  let rawKeyBytes: Uint8Array;
  try {
    rawKeyBytes = base64ToBytes(value.rawKey);
  } catch {
    throw new Error("Room key must be 256 bits");
  }
  if (rawKeyBytes.byteLength !== 32) throw new Error("Room key must be 256 bits");
}
// mutation-policy:end room-secret-validation

// mutation-policy:start device-key-import
export async function importEcdhPublicKey(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    // Stryker disable next-line BooleanLiteral: public input is already public and the internal handle is never returned
    false,
    []
  );
}

export async function importEcdhPrivateKey(privateKeyJwk: DevicePrivateKey): Promise<CryptoKey> {
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

export async function deriveAuthenticatedWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, aad: Uint8Array) {
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const salt = await crypto.subtle.digest("SHA-256", toArrayBuffer(aad));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("multaiplayer:authenticated-room-secret-wrap:v2") },
    material,
    { name: "AES-GCM", length: 256 },
    // Stryker disable next-line BooleanLiteral: derived wrapping key is internal and never exportable through this API
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
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
    // Stryker disable next-line BooleanLiteral: derived wrapping key is internal and never exportable through this API
    false,
    ["encrypt", "decrypt"]
  );
}
// mutation-policy:end device-key-import

// mutation-policy:start device-key-equality
export function sameDevicePublicKey(left: JsonWebKey, right: JsonWebKey): boolean {
  const leftKey = DevicePublicKeyJwk.safeParse(left);
  const rightKey = DevicePublicKeyJwk.safeParse(right);
  return (
    leftKey.success && rightKey.success && leftKey.data.x === rightKey.data.x && leftKey.data.y === rightKey.data.y
  );
}
// mutation-policy:end device-key-equality

// mutation-policy:start device-key-identity
export function jsonWebKeyToDevicePublicKeyJwk(key: JsonWebKey): DevicePublicKeyJwkType {
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
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex.match(/.{4}/g)!.join(":")}`;
}
// mutation-policy:end device-key-identity

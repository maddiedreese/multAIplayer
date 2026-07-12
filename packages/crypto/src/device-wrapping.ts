import type { AuthenticatedWrappedRoomSecretPayload, DeviceSealedPayload } from "@multaiplayer/protocol";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "./encoding.js";
import {
  deriveAuthenticatedWrappingKey,
  deriveWrappingKey,
  importEcdhPrivateKey,
  importEcdhPublicKey,
  jsonWebKeyToDevicePublicKeyJwk,
  sameDevicePublicKey,
  validateRoomSecret
} from "./key-material.js";
import {
  authenticatedWrapAdditionalData,
  deviceSealAdditionalData,
  legacyCryptoContextAdditionalData,
  wrapAdditionalData
} from "./additional-data.js";
import { decryptWithAdditionalData } from "./payload.js";
import type { DeviceCryptoContext, DevicePrivateKey, RoomSecret, WrappedRoomSecret } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// mutation-policy:start authenticated-room-secret-wrap
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
  if (payload.version !== 3) throw new Error("Unsupported authenticated room-secret wrap version");
  if (payload.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256")
    throw new Error("Unsupported authenticated room-secret wrap algorithm");
  const actualSender = jsonWebKeyToDevicePublicKeyJwk(payload.senderPublicKeyJwk);
  const expectedSender = jsonWebKeyToDevicePublicKeyJwk(expectedSenderPublicKeyJwk);
  if (!sameDevicePublicKey(actualSender, expectedSender)) {
    throw new Error("Authenticated room-secret sender key does not match the pinned host key");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const senderPublicKey = await importEcdhPublicKey(actualSender);
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
// mutation-policy:end authenticated-room-secret-wrap

// mutation-policy:start device-seal
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
    // Stryker disable next-line BooleanLiteral: ephemeral private handle never leaves; WebCrypto public half stays exportable
    false,
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
  const hasVersion = Object.hasOwn(payload, "version");
  if (hasVersion && payload.version !== 3) {
    throw new Error("Unsupported device-sealed payload version");
  }
  const recipientPrivateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importEcdhPublicKey(payload.ephemeralPublicKeyJwk);
  const sealingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublicKey);
  const canonical = hasVersion;
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
// mutation-policy:end device-seal

// mutation-policy:start room-secret-wrap
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
    // Stryker disable next-line BooleanLiteral: ephemeral private handle never leaves; WebCrypto public half stays exportable
    false,
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
// mutation-policy:end room-secret-wrap

import {
  createDeviceKeyAgreementIdentity,
  importDevicePrivateKey,
  type DeviceKeyAgreementIdentity
} from "@multaiplayer/crypto";
import { invoke } from "@tauri-apps/api/core";

const deviceIdentityKey = "multaiplayer:device-identity:v1";
let nativeIdentityPromise: Promise<DeviceIdentity> | null = null;
let nativeStartupReadAttempted = false;

export type DeviceIdentity = Omit<DeviceKeyAgreementIdentity, "privateKeyJwk"> & { privateKeyJwk: CryptoKey };

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  if (isTauriRuntime()) {
    nativeIdentityPromise ??= loadOrCreateDeviceIdentityFromStorage();
    return nativeIdentityPromise;
  }
  return loadOrCreateDeviceIdentityFromStorage();
}

async function loadOrCreateDeviceIdentityFromStorage(): Promise<DeviceIdentity> {
  const nativeIdentity = await readNativeDeviceIdentity();
  if (nativeIdentity) return hydrateDeviceIdentity(nativeIdentity);

  const stored = localStorage.getItem(deviceIdentityKey);
  if (stored) {
    try {
      const parsed = normalizeDeviceIdentity(JSON.parse(stored) as Partial<DeviceKeyAgreementIdentity>);
      await writeNativeDeviceIdentity(parsed);
      if (isTauriRuntime()) localStorage.removeItem(deviceIdentityKey);
      return hydrateDeviceIdentity(parsed);
    } catch {
      localStorage.removeItem(deviceIdentityKey);
    }
  }

  const identity = await createDeviceKeyAgreementIdentity();
  await writeNativeDeviceIdentity(identity);
  return hydrateDeviceIdentity(identity);
}

export async function resetDeviceIdentity(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("device_identity_delete");
    nativeIdentityPromise = null;
  }
  localStorage.removeItem(deviceIdentityKey);
}

function normalizeDeviceIdentity(value: Partial<DeviceKeyAgreementIdentity>): DeviceKeyAgreementIdentity {
  if (
    value.algorithm !== "ECDH-P256-HKDF-SHA256-AES-GCM-256" ||
    !value.publicKeyJwk ||
    !value.privateKeyJwk ||
    typeof value.publicKeyFingerprint !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("Stored device identity is invalid");
  }
  return {
    algorithm: value.algorithm,
    publicKeyJwk: value.publicKeyJwk,
    privateKeyJwk: value.privateKeyJwk,
    publicKeyFingerprint: value.publicKeyFingerprint,
    createdAt: value.createdAt
  };
}

async function readNativeDeviceIdentity(): Promise<DeviceKeyAgreementIdentity | null> {
  if (!isTauriRuntime()) return null;
  if (nativeStartupReadAttempted) return null;
  nativeStartupReadAttempted = true;
  const stored = await invoke<string | null>("device_identity_take_for_startup");
  return stored ? normalizeDeviceIdentity(JSON.parse(stored) as Partial<DeviceKeyAgreementIdentity>) : null;
}

async function writeNativeDeviceIdentity(identity: DeviceKeyAgreementIdentity): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(deviceIdentityKey, JSON.stringify(identity));
    return;
  }
  await invoke("device_identity_set", { identity: JSON.stringify(identity) });
}

async function hydrateDeviceIdentity(identity: DeviceKeyAgreementIdentity): Promise<DeviceIdentity> {
  const privateKeyJwk = await importDevicePrivateKey(identity.privateKeyJwk);
  return { ...identity, privateKeyJwk };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

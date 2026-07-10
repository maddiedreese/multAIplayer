import { createDeviceKeyAgreementIdentity, type DeviceKeyAgreementIdentity } from "@multaiplayer/crypto";
import { invoke } from "@tauri-apps/api/core";

const deviceIdentityKey = "multaiplayer:device-identity:v1";

export type DeviceIdentity = DeviceKeyAgreementIdentity;

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const nativeIdentity = await readNativeDeviceIdentity();
  if (nativeIdentity) return nativeIdentity;

  const stored = localStorage.getItem(deviceIdentityKey);
  if (stored) {
    try {
      const parsed = normalizeDeviceIdentity(JSON.parse(stored) as Partial<DeviceIdentity>);
      await writeNativeDeviceIdentity(parsed);
      if (isTauriRuntime()) localStorage.removeItem(deviceIdentityKey);
      return parsed;
    } catch {
      localStorage.removeItem(deviceIdentityKey);
    }
  }

  const identity = await createDeviceKeyAgreementIdentity();
  await writeNativeDeviceIdentity(identity);
  return identity;
}

export async function resetDeviceIdentity(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("device_identity_delete");
  }
  localStorage.removeItem(deviceIdentityKey);
}

function normalizeDeviceIdentity(value: Partial<DeviceIdentity>): DeviceIdentity {
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

async function readNativeDeviceIdentity(): Promise<DeviceIdentity | null> {
  if (!isTauriRuntime()) return null;
  const stored = await invoke<string | null>("device_identity_get");
  return stored ? normalizeDeviceIdentity(JSON.parse(stored) as Partial<DeviceIdentity>) : null;
}

async function writeNativeDeviceIdentity(identity: DeviceIdentity): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(deviceIdentityKey, JSON.stringify(identity));
    return;
  }
  await invoke("device_identity_set", { identity: JSON.stringify(identity) });
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

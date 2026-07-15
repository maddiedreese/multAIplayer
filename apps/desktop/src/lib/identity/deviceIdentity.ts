import { initializeMlsIdentity, type MlsIdentityPublic } from "../mls/mlsClient";

export interface DeviceIdentity extends MlsIdentityPublic {
  publicKeyFingerprint: string;
  signatureKeyFingerprint: string;
  hpkeKeyFingerprint: string;
}

let nativeIdentityPromise: Promise<DeviceIdentity> | null = null;

export async function loadOrCreateDeviceIdentity(githubUserId: string, deviceId: string): Promise<DeviceIdentity> {
  if (!isTauriRuntime()) throw new Error("Device identities are available only in the native desktop app");
  nativeIdentityPromise ??= initializeMlsIdentity(githubUserId, deviceId).then(normalizeIdentity);
  return nativeIdentityPromise;
}

export async function resetDeviceIdentity(): Promise<void> {
  if (!isTauriRuntime()) throw new Error("Device identities are available only in the native desktop app");
  throw new Error("MLS identity reset requires leaving and rejoining every room and is not available in this alpha.");
}

function normalizeIdentity(identity: MlsIdentityPublic): DeviceIdentity {
  if (
    identity.ciphersuite !== 2 ||
    !identity.signaturePublicKey ||
    !identity.signatureKeyFingerprint ||
    !identity.hpkePublicKey ||
    !identity.hpkeKeyFingerprint
  )
    throw new Error("Native MLS identity response is incomplete");
  return {
    ...identity,
    publicKeyFingerprint: identity.signatureKeyFingerprint
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

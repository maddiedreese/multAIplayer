import { initializeMlsIdentity, type MlsIdentityPublic } from "../mls/mlsClient";
import { isTauriRuntime } from "../platform/localBackend/runtime";

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

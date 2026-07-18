import { initializeMlsIdentity, type MlsIdentityPublic } from "../mls/mlsClient";
import { isTauriRuntime } from "../platform/localBackend/runtime";

export interface DeviceIdentity extends MlsIdentityPublic {
  publicKeyFingerprint: string;
  signatureKeyFingerprint: string;
  hpkeKeyFingerprint: string;
}

const nativeIdentityPromises = new Map<string, Promise<DeviceIdentity>>();

export async function loadOrCreateDeviceIdentity(githubUserId: string, deviceId: string): Promise<DeviceIdentity> {
  if (!isTauriRuntime()) throw new Error("Device identities are available only in the native desktop app");
  const scope = `${githubUserId}\u0000${deviceId}`;
  const existing = nativeIdentityPromises.get(scope);
  if (existing) return existing;
  const pending = initializeMlsIdentity(githubUserId, deviceId)
    .then((identity) => normalizeIdentity(identity, githubUserId))
    .catch((error: unknown) => {
      if (nativeIdentityPromises.get(scope) === pending) nativeIdentityPromises.delete(scope);
      throw error;
    });
  nativeIdentityPromises.set(scope, pending);
  return pending;
}

function normalizeIdentity(identity: MlsIdentityPublic, githubUserId: string): DeviceIdentity {
  if (identity.githubUserId !== githubUserId) {
    throw new Error("Native MLS identity does not match the requested account");
  }
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

import type { Dispatch, SetStateAction } from "react";
import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "../lib/deviceIdentity";
import { untrustDeviceKey, type TrustedDeviceKey } from "../lib/deviceTrust";

interface UseAccountActionsOptions {
  selectedRoomId: string;
  deviceId: string;
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
  setDeviceIdentity: Dispatch<SetStateAction<DeviceIdentity | null>>;
  setDeviceIdentityMessage: (message: string | null) => void;
  setTrustedDeviceKeys: Dispatch<SetStateAction<TrustedDeviceKey[]>>;
}

export function useAccountActions({
  selectedRoomId,
  deviceId,
  stopOwnedLocalPreviews,
  signOutGitHub,
  setDeviceIdentity,
  setDeviceIdentityMessage,
  setTrustedDeviceKeys
}: UseAccountActionsOptions) {
  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function rotateDeviceIdentity() {
    setDeviceIdentity(null);
    setDeviceIdentityMessage("Resetting local device identity...");
    try {
      await resetDeviceIdentity();
      const identity = await loadOrCreateDeviceIdentity();
      setDeviceIdentity(identity);
      setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoomId, deviceId));
      setDeviceIdentityMessage("Created new local device identity. Public key registration will refresh automatically.");
    } catch (error) {
      setDeviceIdentityMessage(`Device identity rotation failed: ${String(error)}`);
    }
  }

  return {
    signOut,
    rotateDeviceIdentity
  };
}

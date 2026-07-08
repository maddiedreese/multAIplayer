import type { Dispatch, SetStateAction } from "react";
import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "../lib/deviceIdentity";

interface UseAccountActionsOptions {
  selectedRoomId: string;
  deviceId: string;
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
  setDeviceIdentity: Dispatch<SetStateAction<DeviceIdentity | null>>;
  setDeviceIdentityMessage: (message: string | null) => void;
  untrustDeviceForRoom: (roomId: string, deviceId: string) => void;
}

export function useAccountActions({
  selectedRoomId,
  deviceId,
  stopOwnedLocalPreviews,
  signOutGitHub,
  setDeviceIdentity,
  setDeviceIdentityMessage,
  untrustDeviceForRoom
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
      untrustDeviceForRoom(selectedRoomId, deviceId);
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

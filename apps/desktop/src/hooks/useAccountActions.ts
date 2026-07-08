import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "../lib/deviceIdentity";

interface UseAccountActionsOptions {
  selectedRoomId: string;
  deviceId: string;
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
  replaceDeviceIdentity: (next: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
  untrustDeviceForRoom: (roomId: string, deviceId: string) => void;
}

export function useAccountActions({
  selectedRoomId,
  deviceId,
  stopOwnedLocalPreviews,
  signOutGitHub,
  replaceDeviceIdentity,
  setDeviceIdentityStatusMessage,
  untrustDeviceForRoom
}: UseAccountActionsOptions) {
  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function rotateDeviceIdentity() {
    replaceDeviceIdentity(null);
    setDeviceIdentityStatusMessage("Resetting local device identity...");
    try {
      await resetDeviceIdentity();
      const identity = await loadOrCreateDeviceIdentity();
      replaceDeviceIdentity(identity);
      untrustDeviceForRoom(selectedRoomId, deviceId);
      setDeviceIdentityStatusMessage("Created new local device identity. Public key registration will refresh automatically.");
    } catch (error) {
      setDeviceIdentityStatusMessage(`Device identity rotation failed: ${String(error)}`);
    }
  }

  return {
    signOut,
    rotateDeviceIdentity
  };
}

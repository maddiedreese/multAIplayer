import {
  loadOrCreateDeviceIdentity,
  resetDeviceIdentity,
  type DeviceIdentity
} from "../../lib/identity/deviceIdentity";
import { useAppStore } from "../../store/appStore";
import { currentLocalIdentity } from "../workspace/selectedWorkspace";

interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
  replaceDeviceIdentity: (next: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
  untrustDeviceForRoom: (roomId: string, deviceId: string) => void;
}

export function createAccountActions({
  stopOwnedLocalPreviews,
  signOutGitHub,
  replaceDeviceIdentity,
  setDeviceIdentityStatusMessage,
  untrustDeviceForRoom
}: AccountActionsOptions) {
  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function rotateDeviceIdentity() {
    replaceDeviceIdentity(null);
    setDeviceIdentityStatusMessage("Resetting local device identity...");
    try {
      await resetDeviceIdentity();
      const { localUser, deviceId } = currentLocalIdentity();
      const identity = await loadOrCreateDeviceIdentity(localUser.id, deviceId);
      replaceDeviceIdentity(identity);
      untrustDeviceForRoom(useAppStore.getState().selectedRoomId, currentLocalIdentity().deviceId);
      setDeviceIdentityStatusMessage(
        "Created new local device identity. Public key registration will refresh automatically."
      );
    } catch (error) {
      setDeviceIdentityStatusMessage(`Device identity rotation failed: ${String(error)}`);
    }
  }

  return { signOut, rotateDeviceIdentity };
}

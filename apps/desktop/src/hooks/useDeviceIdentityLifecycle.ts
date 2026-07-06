import { useEffect, type Dispatch, type SetStateAction } from "react";
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from "../lib/deviceIdentity";
import { registerDevice } from "../lib/workspaceClient";

interface UseDeviceIdentityLifecycleOptions {
  relayHttpUrl: string;
  deviceId: string;
  userId: string;
  displayName: string;
  deviceIdentity: DeviceIdentity | null;
  setDeviceIdentity: Dispatch<SetStateAction<DeviceIdentity | null>>;
  setDeviceIdentityMessage: Dispatch<SetStateAction<string | null>>;
}

export function useDeviceIdentityLifecycle({
  relayHttpUrl,
  deviceId,
  userId,
  displayName,
  deviceIdentity,
  setDeviceIdentity,
  setDeviceIdentityMessage
}: UseDeviceIdentityLifecycleOptions) {
  useEffect(() => {
    loadOrCreateDeviceIdentity()
      .then((identity) => {
        setDeviceIdentity(identity);
        setDeviceIdentityMessage(null);
      })
      .catch((error) => {
        setDeviceIdentityMessage(`Device identity unavailable: ${String(error)}`);
      });
  }, [setDeviceIdentity, setDeviceIdentityMessage]);

  useEffect(() => {
    if (!deviceIdentity) return;
    registerDevice({
      userId,
      deviceId,
      displayName,
      publicKeyJwk: deviceIdentity.publicKeyJwk,
      publicKeyFingerprint: deviceIdentity.publicKeyFingerprint
    })
      .then(() => setDeviceIdentityMessage("Device identity registered with relay."))
      .catch((error) => setDeviceIdentityMessage(`Device identity registration pending: ${String(error)}`));
  }, [relayHttpUrl, deviceId, deviceIdentity, displayName, setDeviceIdentityMessage, userId]);
}

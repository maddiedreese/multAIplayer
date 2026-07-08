import { useEffect } from "react";
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from "../lib/deviceIdentity";
import { registerDevice } from "../lib/workspaceClient";

interface UseDeviceIdentityLifecycleOptions {
  relayHttpUrl: string;
  deviceId: string;
  userId: string;
  displayName: string;
  deviceIdentity: DeviceIdentity | null;
  replaceDeviceIdentity: (next: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
}

export function useDeviceIdentityLifecycle({
  relayHttpUrl,
  deviceId,
  userId,
  displayName,
  deviceIdentity,
  replaceDeviceIdentity,
  setDeviceIdentityStatusMessage
}: UseDeviceIdentityLifecycleOptions) {
  useEffect(() => {
    loadOrCreateDeviceIdentity()
      .then((identity) => {
        replaceDeviceIdentity(identity);
        setDeviceIdentityStatusMessage(null);
      })
      .catch((error) => {
        setDeviceIdentityStatusMessage(`Device identity unavailable: ${String(error)}`);
      });
  }, [replaceDeviceIdentity, setDeviceIdentityStatusMessage]);

  useEffect(() => {
    if (!deviceIdentity) return;
    registerDevice({
      userId,
      deviceId,
      displayName,
      publicKeyJwk: deviceIdentity.publicKeyJwk,
      publicKeyFingerprint: deviceIdentity.publicKeyFingerprint
    })
      .then(() => setDeviceIdentityStatusMessage("Device identity registered with relay."))
      .catch((error) => setDeviceIdentityStatusMessage(`Device identity registration pending: ${String(error)}`));
  }, [relayHttpUrl, deviceId, deviceIdentity, displayName, setDeviceIdentityStatusMessage, userId]);
}

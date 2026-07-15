import { useEffect } from "react";
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from "../lib/identity/deviceIdentity";
import { keyPackageCount, publishKeyPackages, registerDevice } from "../application/workspace/workspaceClient";
import { establishDeviceSession } from "../lib/identity/deviceSession";
import { useAppStore } from "../store/appStore";
import { generateMlsKeyPackage } from "../lib/mls/mlsClient";

interface UseDeviceIdentityLifecycleOptions {
  relayHttpUrl: string;
  identityResolved: boolean;
  deviceId: string;
  userId: string;
  displayName: string;
  deviceIdentity: DeviceIdentity | null;
  replaceDeviceIdentity: (next: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
}

export function useDeviceIdentityLifecycle({
  relayHttpUrl,
  identityResolved,
  deviceId,
  userId,
  displayName,
  deviceIdentity,
  replaceDeviceIdentity,
  setDeviceIdentityStatusMessage
}: UseDeviceIdentityLifecycleOptions) {
  useEffect(() => {
    if (!identityResolved) return;
    loadOrCreateDeviceIdentity(userId, deviceId)
      .then((identity) => {
        replaceDeviceIdentity(identity);
        if (identity.requiresRejoin) {
          const store = useAppStore.getState();
          for (const room of store.rooms) store.rememberForgottenRoom(room.id);
          setDeviceIdentityStatusMessage(
            "Encrypted MLS state was quarantined because it was corrupt. This device must rejoin every private room from a new Protocol v2 invite; old local history cannot be recovered."
          );
        } else {
          setDeviceIdentityStatusMessage(null);
        }
      })
      .catch((error) => {
        setDeviceIdentityStatusMessage(`Device identity unavailable: ${String(error)}`);
      });
  }, [deviceId, identityResolved, replaceDeviceIdentity, setDeviceIdentityStatusMessage, userId]);

  useEffect(() => {
    if (!identityResolved || !deviceIdentity) return;
    registerDevice({
      userId,
      deviceId,
      displayName,
      signaturePublicKey: deviceIdentity.signaturePublicKey,
      signatureKeyFingerprint: deviceIdentity.signatureKeyFingerprint!,
      hpkePublicKey: deviceIdentity.hpkePublicKey!,
      hpkeKeyFingerprint: deviceIdentity.hpkeKeyFingerprint!
    })
      .then(() => establishDeviceSession(relayHttpUrl, deviceId))
      .then((session) => {
        useAppStore.getState().replaceDeviceSessionToken(session.token);
        return replenishKeyPackages(deviceId);
      })
      .then(() => {
        if (!deviceIdentity.requiresRejoin)
          setDeviceIdentityStatusMessage("Device identity registered and authenticated with relay.");
      })
      .catch((error) => setDeviceIdentityStatusMessage(`Device identity registration pending: ${String(error)}`));
  }, [relayHttpUrl, deviceId, deviceIdentity, displayName, identityResolved, setDeviceIdentityStatusMessage, userId]);

  useEffect(() => {
    if (!deviceIdentity?.requiresRejoin) return;
    const quarantineRooms = () => {
      const store = useAppStore.getState();
      for (const room of store.rooms) store.rememberForgottenRoom(room.id);
    };
    quarantineRooms();
    return useAppStore.subscribe((state, previous) => {
      if (state.rooms !== previous.rooms) quarantineRooms();
    });
  }, [deviceIdentity?.requiresRejoin]);
}

async function replenishKeyPackages(deviceId: string): Promise<void> {
  const count = await keyPackageCount(deviceId);
  const needed = Math.max(0, 5 - count);
  if (needed === 0) return;
  const keyPackages = await Promise.all(
    Array.from({ length: needed }, async () => {
      return generateMlsKeyPackage();
    })
  );
  await publishKeyPackages(deviceId, keyPackages);
}

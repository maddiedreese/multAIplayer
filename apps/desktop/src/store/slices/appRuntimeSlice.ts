import type { StateCreator } from "zustand";
import type { DeviceIdentity } from "../../lib/deviceIdentity";
import { loadTrustedDeviceKeys, trustDeviceKey, untrustDeviceKey, type TrustedDeviceKey } from "../../lib/deviceTrust";
import type { CodexProbe } from "../../lib/localBackend";
import type { AppStoreState } from "../appStore";

export interface AppRuntimeSlice {
  codexProbe: CodexProbe | null;
  deviceIdentity: DeviceIdentity | null;
  deviceIdentityMessage: string | null;
  trustedDeviceKeys: TrustedDeviceKey[];
  trustedDeviceKeysLoaded: boolean;
  historySearchBusy: boolean;
  replaceCodexProbe: (probe: CodexProbe | null) => void;
  replaceDeviceIdentity: (identity: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
  loadTrustedDeviceKeysOnce: () => void;
  trustDeviceForRoom: (roomId: string, deviceId: string, fingerprint: string) => void;
  untrustDeviceForRoom: (roomId: string, deviceId: string) => void;
  startHistorySearch: () => void;
  finishHistorySearch: () => void;
}

export const emptyAppRuntimeState = {
  codexProbe: null,
  deviceIdentity: null,
  deviceIdentityMessage: null,
  trustedDeviceKeys: [] as TrustedDeviceKey[],
  trustedDeviceKeysLoaded: false,
  historySearchBusy: false
};

export const createAppRuntimeSlice: StateCreator<AppStoreState, [], [], AppRuntimeSlice> = (set, get) => ({
  ...emptyAppRuntimeState,
  replaceCodexProbe: (codexProbe) => set({ codexProbe }),
  replaceDeviceIdentity: (deviceIdentity) => set({ deviceIdentity }),
  setDeviceIdentityStatusMessage: (deviceIdentityMessage) => set({ deviceIdentityMessage }),
  loadTrustedDeviceKeysOnce: () => {
    if (get().trustedDeviceKeysLoaded) return;
    set({ trustedDeviceKeys: loadTrustedDeviceKeys(), trustedDeviceKeysLoaded: true });
  },
  trustDeviceForRoom: (roomId, deviceId, fingerprint) =>
    set((state) => ({
      trustedDeviceKeys: trustDeviceKey(state.trustedDeviceKeys, roomId, deviceId, fingerprint)
    })),
  untrustDeviceForRoom: (roomId, deviceId) =>
    set((state) => ({
      trustedDeviceKeys: untrustDeviceKey(state.trustedDeviceKeys, roomId, deviceId)
    })),
  startHistorySearch: () => set({ historySearchBusy: true }),
  finishHistorySearch: () => set({ historySearchBusy: false })
});

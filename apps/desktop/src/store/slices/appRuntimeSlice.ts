import type { StateCreator } from "zustand";
import type { DeviceIdentity } from "../../lib/identity/deviceIdentity";
import {
  loadDeviceFingerprintComparisons,
  recordDeviceFingerprintComparison,
  removeDeviceFingerprintComparison,
  type DeviceFingerprintComparisonRecord
} from "../../lib/identity/deviceFingerprintComparisons";
import type { CodexProbe } from "../../lib/platform/localBackend";
import type { AppStoreState } from "../appStore";

export interface AppRuntimeSlice {
  codexProbe: CodexProbe | null;
  deviceIdentity: DeviceIdentity | null;
  deviceIdentityMessage: string | null;
  deviceSessionToken: string | null;
  /** Advisory local fingerprint-comparison notes; never authorization state. */
  deviceFingerprintComparisons: DeviceFingerprintComparisonRecord[];
  deviceFingerprintComparisonsLoaded: boolean;
  historySearchBusy: boolean;
  replaceCodexProbe: (probe: CodexProbe | null) => void;
  replaceDeviceIdentity: (identity: DeviceIdentity | null) => void;
  setDeviceIdentityStatusMessage: (message: string | null) => void;
  replaceDeviceSessionToken: (token: string | null) => void;
  loadDeviceFingerprintComparisonsOnce: () => void;
  recordDeviceFingerprintComparisonForRoom: (roomId: string, deviceId: string, fingerprint: string) => void;
  removeDeviceFingerprintComparisonForRoom: (roomId: string, deviceId: string) => void;
  startHistorySearch: () => void;
  finishHistorySearch: () => void;
}

export const emptyAppRuntimeState = {
  codexProbe: null,
  deviceIdentity: null,
  deviceIdentityMessage: null,
  deviceSessionToken: null,
  deviceFingerprintComparisons: [] as DeviceFingerprintComparisonRecord[],
  deviceFingerprintComparisonsLoaded: false,
  historySearchBusy: false
};

export const createAppRuntimeSlice: StateCreator<AppStoreState, [], [], AppRuntimeSlice> = (set, get) => ({
  ...emptyAppRuntimeState,
  replaceCodexProbe: (codexProbe) => set({ codexProbe }),
  replaceDeviceIdentity: (deviceIdentity) => set({ deviceIdentity }),
  setDeviceIdentityStatusMessage: (deviceIdentityMessage) => set({ deviceIdentityMessage }),
  replaceDeviceSessionToken: (deviceSessionToken) => set({ deviceSessionToken }),
  loadDeviceFingerprintComparisonsOnce: () => {
    if (get().deviceFingerprintComparisonsLoaded) return;
    set({
      deviceFingerprintComparisons: loadDeviceFingerprintComparisons(),
      deviceFingerprintComparisonsLoaded: true
    });
  },
  recordDeviceFingerprintComparisonForRoom: (roomId, deviceId, fingerprint) =>
    set((state) => ({
      deviceFingerprintComparisons: recordDeviceFingerprintComparison(
        state.deviceFingerprintComparisons,
        roomId,
        deviceId,
        fingerprint
      )
    })),
  removeDeviceFingerprintComparisonForRoom: (roomId, deviceId) =>
    set((state) => ({
      deviceFingerprintComparisons: removeDeviceFingerprintComparison(
        state.deviceFingerprintComparisons,
        roomId,
        deviceId
      )
    })),
  startHistorySearch: () => set({ historySearchBusy: true }),
  finishHistorySearch: () => set({ historySearchBusy: false })
});

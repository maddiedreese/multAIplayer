import type { StateCreator } from "zustand";
import {
  loadAppConfig,
  normalizeAppConfig,
  resetAppConfig,
  saveAppConfig,
  type AppConfig
} from "../../lib/appConfig";
import type { AppStoreState } from "../appStore";

export interface AppConfigState {
  appConfig: AppConfig;
  relayHttpDraft: string;
  relayWsDraft: string;
  appConfigMessage: string | null;
}

export interface AppConfigSlice extends AppConfigState {
  setRelayHttpDraft: (value: string) => void;
  setRelayWsDraft: (value: string) => void;
  saveRelayConfiguration: () => void;
  resetRelayConfiguration: () => void;
  reloadAppConfig: () => void;
}

function configState(appConfig: AppConfig): AppConfigState {
  return {
    appConfig,
    relayHttpDraft: appConfig.relayHttpUrl,
    relayWsDraft: appConfig.relayWsUrl,
    appConfigMessage: null
  };
}

export function loadAppConfigState(): AppConfigState {
  const appConfig = typeof localStorage === "undefined"
    ? normalizeAppConfig({})
    : loadAppConfig();
  return configState(appConfig);
}

export const emptyAppConfigState = loadAppConfigState();

export const createAppConfigSlice: StateCreator<AppStoreState, [], [], AppConfigSlice> = (set, get) => ({
  ...emptyAppConfigState,
  setRelayHttpDraft: (relayHttpDraft) => set({ relayHttpDraft }),
  setRelayWsDraft: (relayWsDraft) => set({ relayWsDraft }),
  saveRelayConfiguration: () => {
    set({ appConfigMessage: null });
    try {
      const { relayHttpDraft, relayWsDraft } = get();
      const appConfig = saveAppConfig({
        relayHttpUrl: relayHttpDraft,
        relayWsUrl: relayWsDraft
      });
      set({
        ...configState(appConfig),
        appConfigMessage: "Relay configuration saved. Reconnecting rooms and reloading workspace metadata."
      });
    } catch (error) {
      set({ appConfigMessage: String(error) });
    }
  },
  resetRelayConfiguration: () => {
    const appConfig = resetAppConfig();
    set({
      ...configState(appConfig),
      appConfigMessage: "Relay configuration reset to the app defaults."
    });
  },
  reloadAppConfig: () => set(loadAppConfigState())
});

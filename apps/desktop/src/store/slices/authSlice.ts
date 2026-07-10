import type { StateCreator } from "zustand";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../../lib/authClient";
import type { AppStoreState } from "../appStore";

export interface AuthSlice {
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  deviceFlow: GitHubDeviceStart | null;
  authError: string | null;
  authBusy: boolean;
  replaceAuthConfig: (config: GitHubAuthConfig | null) => void;
  replaceCurrentUser: (user: SignedInUser | null) => void;
  replaceDeviceFlow: (flow: GitHubDeviceStart | null) => void;
  setAuthError: (error: string | null) => void;
  setAuthBusy: (busy: boolean) => void;
}

export const emptyAuthState = {
  authConfig: null,
  currentUser: null,
  deviceFlow: null,
  authError: null,
  authBusy: false
};

export const createAuthSlice: StateCreator<AppStoreState, [], [], AuthSlice> = (set) => ({
  ...emptyAuthState,
  replaceAuthConfig: (authConfig) => set({ authConfig }),
  replaceCurrentUser: (currentUser) => set({ currentUser }),
  replaceDeviceFlow: (deviceFlow) => set({ deviceFlow }),
  setAuthError: (authError) => set({ authError }),
  setAuthBusy: (authBusy) => set({ authBusy })
});

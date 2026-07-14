import type { StateCreator } from "zustand";
import {
  createInitialOnboardingState,
  loadOnboardingState,
  reduceOnboardingState,
  saveOnboardingState,
  type OnboardingEvent,
  type OnboardingState
} from "../../lib/onboardingState";
import type { AppStoreState } from "../appStore";

export interface OnboardingSlice {
  onboarding: OnboardingState;
  applyOnboardingEvent: (event: OnboardingEvent) => void;
  reloadOnboarding: () => void;
}

export const emptyOnboardingState = {
  onboarding: typeof localStorage === "undefined" ? createInitialOnboardingState() : loadOnboardingState()
};

export const createOnboardingSlice: StateCreator<AppStoreState, [], [], OnboardingSlice> = (set) => ({
  ...emptyOnboardingState,
  applyOnboardingEvent: (event) => {
    set((state) => {
      const onboarding = reduceOnboardingState(state.onboarding, event);
      saveOnboardingState(onboarding);
      return { onboarding };
    });
  },
  reloadOnboarding: () => set({ onboarding: loadOnboardingState() })
});

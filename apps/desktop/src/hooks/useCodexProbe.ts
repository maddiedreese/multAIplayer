import { useEffect } from "react";
import { probeCodex } from "../lib/localBackend";
import { useAppStore } from "../store/appStore";

export function useCodexProbe() {
  useEffect(() => {
    probeCodex()
      .then((probe) => useAppStore.getState().replaceCodexProbe(probe))
      .catch((error) => {
        useAppStore.getState().replaceCodexProbe({
          available: false,
          version: null,
          error: String(error),
          models: [],
          modelError: null
        });
      });
  }, []);
}

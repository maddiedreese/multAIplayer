import { useEffect, type Dispatch, type SetStateAction } from "react";
import { probeCodex, type CodexProbe } from "../lib/localBackend";

interface UseCodexProbeOptions {
  setCodexProbe: Dispatch<SetStateAction<CodexProbe | null>>;
}

export function useCodexProbe({ setCodexProbe }: UseCodexProbeOptions) {
  useEffect(() => {
    probeCodex().then(setCodexProbe).catch((error) => {
      setCodexProbe({ available: false, version: null, error: String(error) });
    });
  }, [setCodexProbe]);
}

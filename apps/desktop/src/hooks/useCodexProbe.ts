import { useEffect } from "react";
import { probeCodex, type CodexProbe } from "../lib/localBackend";

interface UseCodexProbeOptions {
  replaceCodexProbe: (next: CodexProbe | null) => void;
}

export function useCodexProbe({ replaceCodexProbe }: UseCodexProbeOptions) {
  useEffect(() => {
    probeCodex().then(replaceCodexProbe).catch((error) => {
      replaceCodexProbe({ available: false, version: null, error: String(error), models: [], modelError: null });
    });
  }, [replaceCodexProbe]);
}

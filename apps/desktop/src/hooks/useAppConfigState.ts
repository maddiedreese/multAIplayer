import { useState } from "react";
import { loadAppConfig, resetAppConfig, saveAppConfig, type AppConfig } from "../lib/appConfig";

export function useAppConfigState() {
  const [appConfig, setAppConfig] = useState<AppConfig>(() => loadAppConfig());
  const [relayHttpDraft, setRelayHttpDraft] = useState(() => loadAppConfig().relayHttpUrl);
  const [relayWsDraft, setRelayWsDraft] = useState(() => loadAppConfig().relayWsUrl);
  const [appConfigMessage, setAppConfigMessage] = useState<string | null>(null);

  function saveRelayConfiguration() {
    setAppConfigMessage(null);
    try {
      const next = saveAppConfig({
        relayHttpUrl: relayHttpDraft,
        relayWsUrl: relayWsDraft
      });
      setAppConfig(next);
      setRelayHttpDraft(next.relayHttpUrl);
      setRelayWsDraft(next.relayWsUrl);
      setAppConfigMessage("Relay configuration saved. Reconnecting rooms and reloading workspace metadata.");
    } catch (error) {
      setAppConfigMessage(String(error));
    }
  }

  function resetRelayConfiguration() {
    const next = resetAppConfig();
    setAppConfig(next);
    setRelayHttpDraft(next.relayHttpUrl);
    setRelayWsDraft(next.relayWsUrl);
    setAppConfigMessage("Relay configuration reset to the app defaults.");
  }

  return {
    appConfig,
    relayHttpDraft,
    relayWsDraft,
    appConfigMessage,
    setRelayHttpDraft,
    setRelayWsDraft,
    saveRelayConfiguration,
    resetRelayConfiguration
  };
}

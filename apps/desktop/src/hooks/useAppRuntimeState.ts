import { useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import { loadTrustedDeviceKeys, type TrustedDeviceKey } from "../lib/deviceTrust";
import type { CodexProbe } from "../lib/localBackend";
import { useAppStore } from "../store/appStore";
import type { RelayStatus } from "../types";

export function useAppRuntimeState() {
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [historySearchBusy, setHistorySearchBusy] = useState(false);
  const historySearchMessagesByRoom = useAppStore((state) => state.historySearchMessagesByRoom);
  const setHistorySearchMessagesByRoom = useAppStore((state) => state.setHistorySearchMessagesByRoom);

  return {
    codexProbe,
    setCodexProbe,
    relayStatus,
    setRelayStatus,
    deviceIdentity,
    setDeviceIdentity,
    deviceIdentityMessage,
    setDeviceIdentityMessage,
    trustedDeviceKeys,
    setTrustedDeviceKeys,
    historySearchMessagesByRoom,
    setHistorySearchMessagesByRoom,
    historySearchBusy,
    setHistorySearchBusy
  };
}

import { useMemo, useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import { loadTrustedDeviceKeys, type TrustedDeviceKey } from "../lib/deviceTrust";
import type { CodexProbe } from "../lib/localBackend";
import { useAppStore } from "../store/appStore";
import { projectHistorySearchMessagesByRoom } from "../store/slices/historyPresenceSlice";
import type { RelayStatus } from "../types";

export function useAppRuntimeState() {
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [historySearchBusy, setHistorySearchBusy] = useState(false);
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const historySearchMessagesByRoom = useMemo(
    () => projectHistorySearchMessagesByRoom(historyPresenceByRoom),
    [historyPresenceByRoom]
  );

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
    historySearchBusy,
    setHistorySearchBusy
  };
}

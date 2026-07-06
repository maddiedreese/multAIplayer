import { useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import { loadTrustedDeviceKeys, type TrustedDeviceKey } from "../lib/deviceTrust";
import type { CodexProbe } from "../lib/localBackend";
import type { ChatMessage, RelayStatus } from "../types";

export function useAppRuntimeState() {
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [historySearchMessagesByRoom, setHistorySearchMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [historySearchBusy, setHistorySearchBusy] = useState(false);

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

import { useCallback, useMemo, useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import {
  loadTrustedDeviceKeys,
  trustDeviceKey,
  untrustDeviceKey,
  type TrustedDeviceKey
} from "../lib/deviceTrust";
import type { CodexProbe } from "../lib/localBackend";
import { useAppStore } from "../store/appStore";
import { projectHistorySearchMessagesByRoom } from "../store/slices/historyPresenceSlice";
import type { RelayStatus } from "../types";

export function useAppRuntimeState() {
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const replaceCodexProbe = useCallback((next: CodexProbe | null) => {
    setCodexProbe(next);
  }, []);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const replaceRelayStatus = useCallback((next: RelayStatus) => {
    setRelayStatus(next);
  }, []);
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const replaceDeviceIdentity = useCallback((next: DeviceIdentity | null) => {
    setDeviceIdentity(next);
  }, []);
  const setDeviceIdentityStatusMessage = useCallback((message: string | null) => {
    setDeviceIdentityMessage(message);
  }, []);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const trustDeviceForRoom = useCallback((roomId: string, deviceId: string, fingerprint: string) => {
    setTrustedDeviceKeys((current) => trustDeviceKey(current, roomId, deviceId, fingerprint));
  }, []);
  const untrustDeviceForRoom = useCallback((roomId: string, deviceId: string) => {
    setTrustedDeviceKeys((current) => untrustDeviceKey(current, roomId, deviceId));
  }, []);
  const [historySearchBusy, setHistorySearchBusy] = useState(false);
  const startHistorySearch = useCallback(() => {
    setHistorySearchBusy(true);
  }, []);
  const finishHistorySearch = useCallback(() => {
    setHistorySearchBusy(false);
  }, []);
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const historySearchMessagesByRoom = useMemo(
    () => projectHistorySearchMessagesByRoom(historyPresenceByRoom),
    [historyPresenceByRoom]
  );

  return {
    codexProbe,
    replaceCodexProbe,
    relayStatus,
    replaceRelayStatus,
    deviceIdentity,
    replaceDeviceIdentity,
    deviceIdentityMessage,
    setDeviceIdentityStatusMessage,
    trustedDeviceKeys,
    setTrustedDeviceKeys,
    trustDeviceForRoom,
    untrustDeviceForRoom,
    historySearchMessagesByRoom,
    historySearchBusy,
    startHistorySearch,
    finishHistorySearch
  };
}

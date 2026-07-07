import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  hasHistorySettings,
  loadEncryptedHistory,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../lib/localHistory";
import { normalizeLocalRoomHistory, pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import type {
  ChatMessage,
  LocalRoomHistoryPayload
} from "../types";

interface LatestRef<T> {
  current: T;
}

interface UseLocalHistoryHydrationOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomTeamId: string;
  forgottenRoomIds: Set<string>;
  historyLoadedRoomIds: LatestRef<Set<string>>;
  setHistorySettings: Dispatch<SetStateAction<LocalHistorySettings>>;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
}

export function useLocalHistoryHydration({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomTeamId,
  forgottenRoomIds,
  historyLoadedRoomIds,
  setHistorySettings,
  hydrateLocalRoomHistoryForRoom
}: UseLocalHistoryHydrationOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId)) {
      setHistorySettings(loadHistorySettings(selectedRoomId));
      return;
    }
    let cancelled = false;
    const settings = hasHistorySettings(selectedRoomId)
      ? loadHistorySettings(selectedRoomId)
      : loadTeamHistorySettings(selectedRoomTeamId);
    if (!hasHistorySettings(selectedRoomId)) {
      saveHistorySettings(selectedRoomId, settings);
    }
    setHistorySettings(settings);
    loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(selectedRoomId).then((storedHistory) => {
      if (cancelled || !storedHistory) return;
      const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
      hydrateLocalRoomHistoryForRoom(selectedRoomId, payload);
    }).catch((error) => {
      if (!cancelled) console.warn("Failed to load encrypted local history", error);
    }).finally(() => {
      if (!cancelled) historyLoadedRoomIds.current.add(selectedRoomId);
    });
    return () => {
      cancelled = true;
    };
  }, [
    forgottenRoomIds,
    hasSelectedRoom,
    hydrateLocalRoomHistoryForRoom,
    selectedRoomTeamId,
    selectedRoomId,
    setHistorySettings
  ]);
}

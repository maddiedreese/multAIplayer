import { useEffect } from "react";
import {
  hasHistorySettings,
  loadEncryptedHistory,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../lib/localHistory";
import { normalizeLocalRoomHistory, pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import type { ChatMessage, LocalRoomHistoryPayload, LocalRoomReadState } from "../types";

interface LatestRef<T> {
  current: T;
}

interface UseLocalHistoryHydrationOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomTeamId: string;
  forgottenRoomIds: Set<string>;
  historyLoadedRoomIds: LatestRef<Set<string>>;
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  hydrateRoomReadState: (roomId: string, readState?: LocalRoomReadState) => void;
}

export function useLocalHistoryHydration({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomTeamId,
  forgottenRoomIds,
  historyLoadedRoomIds,
  replaceHistorySettings,
  hydrateLocalRoomHistoryForRoom,
  hydrateRoomReadState
}: UseLocalHistoryHydrationOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId)) {
      replaceHistorySettings(loadHistorySettings(selectedRoomId));
      return;
    }
    let cancelled = false;
    const settings = hasHistorySettings(selectedRoomId)
      ? loadHistorySettings(selectedRoomId)
      : loadTeamHistorySettings(selectedRoomTeamId);
    if (!hasHistorySettings(selectedRoomId)) {
      saveHistorySettings(selectedRoomId, settings);
    }
    replaceHistorySettings(settings);
    loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(selectedRoomId)
      .then((storedHistory) => {
        if (cancelled || !storedHistory) return;
        const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
        hydrateLocalRoomHistoryForRoom(selectedRoomId, payload);
        hydrateRoomReadState(selectedRoomId, payload.readState);
      })
      .catch(() => {
        if (!cancelled) console.warn("Failed to load encrypted local history");
      })
      .finally(() => {
        if (!cancelled) historyLoadedRoomIds.current.add(selectedRoomId);
      });
    return () => {
      cancelled = true;
    };
  }, [
    forgottenRoomIds,
    hasSelectedRoom,
    historyLoadedRoomIds,
    hydrateLocalRoomHistoryForRoom,
    hydrateRoomReadState,
    selectedRoomTeamId,
    selectedRoomId,
    replaceHistorySettings
  ]);
}

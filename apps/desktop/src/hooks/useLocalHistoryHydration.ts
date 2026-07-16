import { useEffect } from "react";
import {
  hasHistorySettings,
  loadEncryptedHistory,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../lib/history/localHistory";
import { normalizeRetainedLocalRoomHistory } from "../lib/history/localRoomHistoryPayload";
import { reportNonFatal } from "../lib/core/nonFatalReporting";
import {
  clearMatchingHistoryMessage,
  historyHydrationFailureMessage
} from "../application/history/localHistorySnapshot";
import { useAppStore } from "../store/appStore";
import type { ChatMessage, LocalRoomHistoryPayload, LocalRoomReadState } from "../types";

interface UseLocalHistoryHydrationOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string | null;
  selectedRoomTeamId: string;
  forgottenRoomIds: Set<string>;
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  hydrateRoomReadState: (roomId: string, readState?: LocalRoomReadState) => void;
}

export function useLocalHistoryHydration({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomTeamId,
  forgottenRoomIds,
  replaceHistorySettings,
  hydrateLocalRoomHistoryForRoom,
  hydrateRoomReadState
}: UseLocalHistoryHydrationOptions) {
  const hydrationAttempt = useAppStore((state) =>
    selectedRoomId ? (state.historyPresenceByRoom[selectedRoomId]?.historyHydrationAttempt ?? 0) : 0
  );
  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) return;
    if (forgottenRoomIds.has(selectedRoomId)) {
      replaceHistorySettings(loadHistorySettings(selectedRoomId));
      return;
    }
    let cancelled = false;
    useAppStore.getState().setHistoryHydrationStatusForRoom(selectedRoomId, "loading");
    const settings = hasHistorySettings(selectedRoomId)
      ? loadHistorySettings(selectedRoomId)
      : loadTeamHistorySettings(selectedRoomTeamId);
    const initializeSettings = hasHistorySettings(selectedRoomId)
      ? Promise.resolve(settings)
      : saveHistorySettings(selectedRoomId, settings);
    initializeSettings
      .then((savedSettings) => {
        if (!cancelled) replaceHistorySettings(savedSettings);
        return loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(selectedRoomId);
      })
      .then((storedHistory) => {
        if (cancelled) return;
        if (storedHistory) {
          const payload = normalizeRetainedLocalRoomHistory(storedHistory, settings.retentionDays);
          const hadLiveMessages = (useAppStore.getState().messagesByRoom[selectedRoomId]?.length ?? 0) > 0;
          hydrateLocalRoomHistoryForRoom(selectedRoomId, payload);
          if (!hadLiveMessages) hydrateRoomReadState(selectedRoomId, payload.readState);
        }
        useAppStore.getState().setHistoryHydrationStatusForRoom(selectedRoomId, "ready");
        clearMatchingHistoryMessage(selectedRoomId, historyHydrationFailureMessage);
      })
      .catch((error) => {
        if (cancelled) return;
        reportNonFatal("load encrypted local history", error);
        const state = useAppStore.getState();
        state.setHistoryHydrationStatusForRoom(selectedRoomId, "failed");
        state.setHistoryMessageForRoom(selectedRoomId, historyHydrationFailureMessage);
      });
    return () => {
      cancelled = true;
    };
  }, [
    forgottenRoomIds,
    hasSelectedRoom,
    hydrationAttempt,
    hydrateLocalRoomHistoryForRoom,
    hydrateRoomReadState,
    selectedRoomTeamId,
    selectedRoomId,
    replaceHistorySettings
  ]);
}

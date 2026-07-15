import { useEffect } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { loadEncryptedHistory, loadHistorySettings } from "../lib/localHistory";
import { normalizeLocalRoomHistory, pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { useAppStore } from "../store/appStore";
import { historySearchEntriesToMessagesByRoom } from "../store/slices/historyPresenceSlice";
import type { ChatMessage, LocalRoomHistoryPayload } from "../types";

interface UseHistorySearchOptions {
  searchActive: boolean;
  rooms: ClientRoomRecord[];
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  startHistorySearch: () => void;
  finishHistorySearch: () => void;
}

export function useHistorySearch({
  searchActive,
  rooms,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  startHistorySearch,
  finishHistorySearch
}: UseHistorySearchOptions) {
  const setHistorySearchResultsByRoom = useAppStore((state) => state.setHistorySearchResultsByRoom);
  const clearHistorySearchResults = useAppStore((state) => state.clearHistorySearchResults);

  useEffect(() => {
    if (!searchActive) {
      clearHistorySearchResults();
      finishHistorySearch();
      return;
    }

    let cancelled = false;
    const searchableRooms = rooms.filter(
      (room) => !forgottenRoomIds.has(room.id) && !revokedRoomIds.has(room.id) && !revokedTeamIds.has(room.teamId)
    );
    if (searchableRooms.length > 0) {
      startHistorySearch();
    } else {
      finishHistorySearch();
    }
    Promise.all(
      searchableRooms.map(async (room) => {
        const storedHistory = await loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(room.id);
        if (!storedHistory) return [room.id, []] as const;
        const settings = loadHistorySettings(room.id);
        const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
        return [room.id, payload.messages] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setHistorySearchResultsByRoom(historySearchEntriesToMessagesByRoom(entries));
      })
      .catch(() => {
        if (!cancelled) console.warn("Failed to search encrypted local history");
      })
      .finally(() => {
        if (!cancelled) finishHistorySearch();
      });

    return () => {
      cancelled = true;
    };
  }, [
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    rooms,
    searchActive,
    startHistorySearch,
    finishHistorySearch,
    clearHistorySearchResults,
    setHistorySearchResultsByRoom
  ]);
}

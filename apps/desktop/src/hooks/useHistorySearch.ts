import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { loadEncryptedHistory, loadHistorySettings } from "../lib/localHistory";
import { normalizeLocalRoomHistory, pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { useAppStore } from "../store/appStore";
import type { ChatMessage, LocalRoomHistoryPayload } from "../types";

interface UseHistorySearchOptions {
  searchActive: boolean;
  rooms: RoomRecord[];
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  setHistorySearchBusy: Dispatch<SetStateAction<boolean>>;
}

export function useHistorySearch({
  searchActive,
  rooms,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  setHistorySearchBusy
}: UseHistorySearchOptions) {
  const setHistorySearchResultsByRoom = useAppStore((state) => state.setHistorySearchResultsByRoom);
  const clearHistorySearchResults = useAppStore((state) => state.clearHistorySearchResults);

  useEffect(() => {
    if (!searchActive) {
      clearHistorySearchResults();
      setHistorySearchBusy(false);
      return;
    }

    let cancelled = false;
    const searchableRooms = rooms.filter((room) =>
      !forgottenRoomIds.has(room.id) &&
      !revokedRoomIds.has(room.id) &&
      !revokedTeamIds.has(room.teamId)
    );
    setHistorySearchBusy(searchableRooms.length > 0);
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
        setHistorySearchResultsByRoom(
          Object.fromEntries(entries.filter(([, roomMessages]) => roomMessages.length > 0))
        );
      })
      .catch((error) => {
        if (!cancelled) console.warn("Failed to search encrypted local history", error);
      })
      .finally(() => {
        if (!cancelled) setHistorySearchBusy(false);
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
    setHistorySearchBusy,
    clearHistorySearchResults,
    setHistorySearchResultsByRoom
  ]);
}

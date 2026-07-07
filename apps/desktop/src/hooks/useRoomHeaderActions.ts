import type { Dispatch, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import { useAppStore } from "../store/appStore";

export function useRoomHeaderActions({
  rooms,
  selectedRoomId,
  selectedRoomIdForTabs,
  activeBrowserUrl,
  setSelectedTeam,
  setSelectedRoomId,
  openRoomBrowserNow
}: {
  rooms: RoomRecord[];
  selectedRoomId: string;
  selectedRoomIdForTabs: string;
  activeBrowserUrl: string | null;
  setSelectedTeam: Dispatch<SetStateAction<string>>;
  setSelectedRoomId: Dispatch<SetStateAction<string>>;
  openRoomBrowserNow: () => void;
}) {
  const setInspectorTabForRoom = useAppStore((state) => state.setInspectorTabForRoom);

  function onSelectTeam(teamId: string) {
    setSelectedTeam(teamId);
    setSelectedRoomId(rooms.find((room) => room.teamId === teamId)?.id ?? selectedRoomId);
  }

  function onSelectInspectorTab(tab: InspectorTab) {
    setInspectorTabForRoom(selectedRoomIdForTabs, tab);
    if (tab === "browser" && !activeBrowserUrl) openRoomBrowserNow();
  }

  return {
    onSelectTeam,
    onSelectInspectorTab
  };
}

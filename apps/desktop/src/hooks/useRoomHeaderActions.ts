import type { Dispatch, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { InspectorTab } from "../components/RoomInspectorPanel";

export function useRoomHeaderActions({
  rooms,
  selectedRoomId,
  selectedRoomIdForTabs,
  activeBrowserUrl,
  setSelectedTeam,
  setSelectedRoomId,
  setInspectorTabsByRoom,
  openRoomBrowserNow
}: {
  rooms: RoomRecord[];
  selectedRoomId: string;
  selectedRoomIdForTabs: string;
  activeBrowserUrl: string | null;
  setSelectedTeam: Dispatch<SetStateAction<string>>;
  setSelectedRoomId: Dispatch<SetStateAction<string>>;
  setInspectorTabsByRoom: Dispatch<SetStateAction<Record<string, InspectorTab>>>;
  openRoomBrowserNow: () => void;
}) {
  function onSelectTeam(teamId: string) {
    setSelectedTeam(teamId);
    setSelectedRoomId(rooms.find((room) => room.teamId === teamId)?.id ?? selectedRoomId);
  }

  function onSelectInspectorTab(tab: InspectorTab) {
    setInspectorTabsByRoom((current) => ({ ...current, [selectedRoomIdForTabs]: tab }));
    if (tab === "browser" && !activeBrowserUrl) openRoomBrowserNow();
  }

  return {
    onSelectTeam,
    onSelectInspectorTab
  };
}

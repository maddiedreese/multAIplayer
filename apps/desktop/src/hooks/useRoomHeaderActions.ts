import type { InspectorTab } from "../components/RoomInspectorPanel";
import { useAppStore } from "../store/appStore";

export function useRoomHeaderActions({
  selectedRoomId,
  selectedRoomIdForTabs,
  activeBrowserUrl,
  selectTeamRoom,
  openRoomBrowserNow
}: {
  selectedRoomId: string;
  selectedRoomIdForTabs: string;
  activeBrowserUrl: string | null;
  selectTeamRoom: (teamId: string, fallbackRoomId: string) => void;
  openRoomBrowserNow: () => void;
}) {
  const setInspectorTabForRoom = useAppStore((state) => state.setInspectorTabForRoom);

  function onSelectTeam(teamId: string) {
    selectTeamRoom(teamId, selectedRoomId);
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

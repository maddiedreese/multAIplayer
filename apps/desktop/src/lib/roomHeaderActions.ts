import type { InspectorTab } from "../components/RoomInspectorPanel";
import { useAppStore } from "../store/appStore";

export function createRoomHeaderActions({
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
  function onSelectTeam(teamId: string) {
    selectTeamRoom(teamId, selectedRoomId);
  }

  function onSelectInspectorTab(tab: InspectorTab) {
    useAppStore.getState().setInspectorTabForRoom(selectedRoomIdForTabs, tab);
    if (tab === "browser" && !activeBrowserUrl) openRoomBrowserNow();
  }

  return {
    onSelectTeam,
    onSelectInspectorTab
  };
}

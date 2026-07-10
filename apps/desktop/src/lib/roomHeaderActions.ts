import type { InspectorTab } from "../components/RoomInspectorPanel";
import { useAppStore } from "../store/appStore";

export function createRoomHeaderActions({ openRoomBrowserNow }: { openRoomBrowserNow: () => void }) {
  function onSelectTeam(teamId: string) {
    const state = useAppStore.getState();
    state.selectTeamRoom(teamId, state.selectedRoomId);
  }

  function onSelectInspectorTab(tab: InspectorTab) {
    const state = useAppStore.getState();
    state.setInspectorTabForRoom(state.selectedRoomId, tab);
    if (tab === "browser" && !state.browserByRoom[state.selectedRoomId]?.activeUrl) openRoomBrowserNow();
  }

  return {
    onSelectTeam,
    onSelectInspectorTab
  };
}

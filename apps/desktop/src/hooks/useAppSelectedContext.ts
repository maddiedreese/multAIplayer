import { useMarkdownSelection } from "./useMarkdownSelection";
import { useSelectedRoomContext } from "./useSelectedRoomContext";
import { useSelectedRoomValues } from "./useSelectedRoomValues";
import { useSelectedTeamData } from "./useSelectedTeamData";

export function useAppSelectedContext({
  roomContext,
  markdownSelection,
  teamData,
  roomValues
}: {
  roomContext: Parameters<typeof useSelectedRoomContext>[0];
  markdownSelection: Omit<Parameters<typeof useMarkdownSelection>[0], "activeRoomId" | "enabled">;
  teamData: Parameters<typeof useSelectedTeamData>[0];
  roomValues: Omit<
    Parameters<typeof useSelectedRoomValues>[0],
    "selectedRoom" | "selectedMessageIds" | "markdownSelectionMode"
  >;
}) {
  const selectedRoomContext = useSelectedRoomContext(roomContext);
  const markdownSelectionState = useMarkdownSelection({
    activeRoomId: selectedRoomContext.selectedRoom?.id ?? null,
    enabled: selectedRoomContext.hasSelectedRoom,
    ...markdownSelection
  });
  const selectedTeamData = useSelectedTeamData(teamData);
  const selectedRoomValues = useSelectedRoomValues({
    selectedRoom: selectedRoomContext.selectedRoom,
    selectedMessageIds: markdownSelectionState.selectedMessageIds,
    markdownSelectionMode: markdownSelectionState.markdownSelectionMode,
    ...roomValues
  });

  return {
    ...selectedRoomContext,
    ...markdownSelectionState,
    ...selectedTeamData,
    ...selectedRoomValues
  };
}

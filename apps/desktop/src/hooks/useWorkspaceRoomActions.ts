import { useFileActions } from "./useFileActions";
import { useLocalHistoryActions } from "./useLocalHistoryActions";
import { useMemberActions } from "./useMemberActions";
import { useTeamDefaultActions } from "./useTeamDefaultActions";
import { useWorkspaceCreationActions } from "./useWorkspaceCreationActions";

export function useWorkspaceRoomActions({
  members,
  workspaceCreation,
  teamDefaults,
  localHistory,
  files
}: {
  members: Parameters<typeof useMemberActions>[0];
  workspaceCreation: Parameters<typeof useWorkspaceCreationActions>[0];
  teamDefaults: Parameters<typeof useTeamDefaultActions>[0];
  localHistory: Parameters<typeof useLocalHistoryActions>[0];
  files: Parameters<typeof useFileActions>[0];
}) {
  return {
    ...useMemberActions(members),
    ...useWorkspaceCreationActions(workspaceCreation),
    ...useTeamDefaultActions(teamDefaults),
    ...useLocalHistoryActions(localHistory),
    ...useFileActions(files)
  };
}

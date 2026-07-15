import { createFileActions } from "../files/fileActions";
import { createLocalHistoryActions } from "../history/localHistoryActions";
import { createMemberActions } from "../members/memberActions";
import { createTeamDefaultActions } from "../teams/teamDefaultActions";
import { createWorkspaceCreationActions } from "./workspaceCreationActions";

export function createWorkspaceRoomActions({
  members,
  workspaceCreation,
  teamDefaults,
  localHistory,
  files
}: {
  members: Parameters<typeof createMemberActions>[0];
  workspaceCreation: Parameters<typeof createWorkspaceCreationActions>[0];
  teamDefaults: Parameters<typeof createTeamDefaultActions>[0];
  localHistory: Parameters<typeof createLocalHistoryActions>[0];
  files: Parameters<typeof createFileActions>[0];
}) {
  return {
    ...createMemberActions(members),
    ...createWorkspaceCreationActions(workspaceCreation),
    ...createTeamDefaultActions(teamDefaults),
    ...createLocalHistoryActions(localHistory),
    ...createFileActions(files)
  };
}

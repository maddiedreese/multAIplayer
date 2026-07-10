import { createFileActions } from "./fileActions";
import { createLocalHistoryActions } from "./localHistoryActions";
import { createMemberActions } from "./memberActions";
import { createTeamDefaultActions } from "./teamDefaultActions";
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

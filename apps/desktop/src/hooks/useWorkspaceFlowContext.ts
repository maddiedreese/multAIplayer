import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { createMarkdownCopyActions } from "../application/markdown/markdownCopyActions";
import { useHistorySearch } from "./useHistorySearch";
import { useLocalHistoryHydration } from "./useLocalHistoryHydration";
import { createFileActions } from "../application/files/fileActions";
import { createLocalHistoryActions } from "../application/history/localHistoryActions";
import { createMemberActions } from "../application/members/memberActions";
import { createTeamDefaultActions } from "../application/teams/teamDefaultActions";
import { createWorkspaceCreationActions } from "../application/workspace/workspaceCreationActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
interface WorkspaceHistoryOptions {
  hydration: Parameters<typeof useLocalHistoryHydration>[0];
  search: Parameters<typeof useHistorySearch>[0];
}
interface WorkspaceRoomActionOptions {
  members: Parameters<typeof createMemberActions>[0];
  workspaceCreation: Parameters<typeof createWorkspaceCreationActions>[0];
  teamDefaults: Parameters<typeof createTeamDefaultActions>[0];
  localHistory: Parameters<typeof createLocalHistoryActions>[0];
  files: Parameters<typeof createFileActions>[0];
}
type WorkspaceMemberOptions = WorkspaceRoomActionOptions["members"];

export function useWorkspaceFlowContext({
  bootstrap,
  workspaceRoomActions,
  historyEffects
}: {
  bootstrap: AppBootstrapOptions;
  workspaceRoomActions: Omit<WorkspaceRoomActionOptions, "members"> & {
    members: Omit<WorkspaceMemberOptions, "copyMarkdownWithFallback">;
  };
  historyEffects: WorkspaceHistoryOptions;
}) {
  useAppBootstrapEffects(bootstrap);
  const markdownCopyActions = createMarkdownCopyActions();
  const memberActions = createMemberActions({
    ...workspaceRoomActions.members,
    copyMarkdownWithFallback: markdownCopyActions.copyMarkdownWithFallback
  });
  useLocalHistoryHydration(historyEffects.hydration);
  useHistorySearch(historyEffects.search);

  return {
    ...markdownCopyActions,
    ...memberActions,
    ...createWorkspaceCreationActions(workspaceRoomActions.workspaceCreation),
    ...createTeamDefaultActions(workspaceRoomActions.teamDefaults),
    ...createLocalHistoryActions(workspaceRoomActions.localHistory),
    ...createFileActions(workspaceRoomActions.files)
  };
}

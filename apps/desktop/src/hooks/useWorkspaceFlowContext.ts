import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { createMarkdownCopyActions } from "../application/markdown/markdownCopyActions";
import { useWorkspaceHistoryEffects } from "./useWorkspaceHistoryEffects";
import { createWorkspaceRoomActions } from "../application/workspace/workspaceRoomActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
type WorkspaceHistoryOptions = Parameters<typeof useWorkspaceHistoryEffects>[0];
type WorkspaceRoomActionOptions = Parameters<typeof createWorkspaceRoomActions>[0];
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
  const workspaceActions = createWorkspaceRoomActions({
    ...workspaceRoomActions,
    members: {
      ...workspaceRoomActions.members,
      copyMarkdownWithFallback: markdownCopyActions.copyMarkdownWithFallback
    }
  });
  useWorkspaceHistoryEffects(historyEffects);

  return {
    ...markdownCopyActions,
    ...workspaceActions
  };
}

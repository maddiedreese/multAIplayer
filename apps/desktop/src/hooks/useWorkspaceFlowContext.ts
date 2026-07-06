import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { useMarkdownCopyActions } from "./useMarkdownCopyActions";
import { useWorkspaceHistoryEffects } from "./useWorkspaceHistoryEffects";
import { useWorkspaceRoomActions } from "./useWorkspaceRoomActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
type MarkdownCopyOptions = Parameters<typeof useMarkdownCopyActions>[0];
type WorkspaceHistoryOptions = Parameters<typeof useWorkspaceHistoryEffects>[0];
type WorkspaceRoomActionOptions = Parameters<typeof useWorkspaceRoomActions>[0];
type WorkspaceMemberOptions = WorkspaceRoomActionOptions["members"];

export function useWorkspaceFlowContext({
  bootstrap,
  markdownCopy,
  workspaceRoomActions,
  historyEffects
}: {
  bootstrap: AppBootstrapOptions;
  markdownCopy: MarkdownCopyOptions;
  workspaceRoomActions: Omit<WorkspaceRoomActionOptions, "members"> & {
    members: Omit<WorkspaceMemberOptions, "copyMarkdownWithFallback">;
  };
  historyEffects: WorkspaceHistoryOptions;
}) {
  useAppBootstrapEffects(bootstrap);
  const markdownCopyActions = useMarkdownCopyActions(markdownCopy);
  const workspaceActions = useWorkspaceRoomActions({
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

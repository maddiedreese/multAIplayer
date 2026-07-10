import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { createMarkdownCopyActions } from "../lib/markdownCopyActions";
import { useWorkspaceHistoryEffects } from "./useWorkspaceHistoryEffects";
import { createWorkspaceRoomActions } from "../lib/workspaceRoomActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
type MarkdownCopyOptions = Parameters<typeof createMarkdownCopyActions>[0];
type WorkspaceHistoryOptions = Parameters<typeof useWorkspaceHistoryEffects>[0];
type WorkspaceRoomActionOptions = Parameters<typeof createWorkspaceRoomActions>[0];
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
  const markdownCopyActions = createMarkdownCopyActions(markdownCopy);
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

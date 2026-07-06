import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { useMarkdownCopyActions } from "./useMarkdownCopyActions";
import { useWorkspaceRoomActions } from "./useWorkspaceRoomActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
type MarkdownCopyOptions = Parameters<typeof useMarkdownCopyActions>[0];
type WorkspaceRoomActionOptions = Parameters<typeof useWorkspaceRoomActions>[0];
type WorkspaceMemberOptions = WorkspaceRoomActionOptions["members"];

export function useWorkspaceFlowContext({
  bootstrap,
  markdownCopy,
  workspaceRoomActions
}: {
  bootstrap: AppBootstrapOptions;
  markdownCopy: MarkdownCopyOptions;
  workspaceRoomActions: Omit<WorkspaceRoomActionOptions, "members"> & {
    members: Omit<WorkspaceMemberOptions, "copyMarkdownWithFallback">;
  };
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

  return {
    ...markdownCopyActions,
    ...workspaceActions
  };
}

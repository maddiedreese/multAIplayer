import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { createMarkdownCopyActions } from "../application/markdown/markdownCopyActions";
import { useHistorySearch } from "./useHistorySearch";
import { useLocalHistoryHydration } from "./useLocalHistoryHydration";
import { createWorkspaceRoomActions } from "../application/workspace/workspaceRoomActions";

type AppBootstrapOptions = Parameters<typeof useAppBootstrapEffects>[0];
interface WorkspaceHistoryOptions {
  hydration: Parameters<typeof useLocalHistoryHydration>[0];
  search: Parameters<typeof useHistorySearch>[0];
}
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
  useLocalHistoryHydration(historyEffects.hydration);
  useHistorySearch(historyEffects.search);

  return {
    ...markdownCopyActions,
    ...workspaceActions
  };
}

import { useAccountActions } from "./useAccountActions";
import { useBrowserActions } from "./useBrowserActions";
import { useGitHubActionsRefresh } from "./useGitHubActionsRefresh";
import { useGitWorkflowActions } from "./useGitWorkflowActions";
import { useLocalPreviewActions } from "./useLocalPreviewActions";
import { useRoomSettingsActions } from "./useRoomSettingsActions";
import { useTerminalActions } from "./useTerminalActions";

type AccountActionsOptions = Omit<Parameters<typeof useAccountActions>[0], "stopOwnedLocalPreviews">;
type GitWorkflowActionsOptions = Omit<Parameters<typeof useGitWorkflowActions>[0], "refreshGitHubActions">;

export function useRoomToolActions({
  settings,
  terminal,
  localPreview,
  account,
  githubActions,
  gitWorkflow,
  browser
}: {
  settings: Parameters<typeof useRoomSettingsActions>[0];
  terminal: Parameters<typeof useTerminalActions>[0];
  localPreview: Parameters<typeof useLocalPreviewActions>[0];
  account: AccountActionsOptions;
  githubActions: Parameters<typeof useGitHubActionsRefresh>[0];
  gitWorkflow: GitWorkflowActionsOptions;
  browser: Parameters<typeof useBrowserActions>[0];
}) {
  const roomSettingsActions = useRoomSettingsActions(settings);
  const terminalActions = useTerminalActions(terminal);
  const localPreviewActions = useLocalPreviewActions(localPreview);
  const accountActions = useAccountActions({
    ...account,
    stopOwnedLocalPreviews: localPreviewActions.stopOwnedLocalPreviews
  });
  const { refreshGitHubActions } = useGitHubActionsRefresh(githubActions);
  const gitWorkflowActions = useGitWorkflowActions({
    ...gitWorkflow,
    refreshGitHubActions
  });
  const browserActions = useBrowserActions(browser);

  return {
    ...roomSettingsActions,
    ...terminalActions,
    ...localPreviewActions,
    ...accountActions,
    refreshGitHubActions,
    ...gitWorkflowActions,
    ...browserActions
  };
}

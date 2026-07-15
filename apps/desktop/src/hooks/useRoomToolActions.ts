import { createAccountActions } from "../application/account/accountActions";
import { createBrowserActions } from "../application/browser/browserActions";
import { createGitWorkflowActions } from "../application/git/gitWorkflowActions";
import { createLocalPreviewActions } from "../application/files/localPreviewActions";
import { createRoomSettingsActions } from "../application/rooms/roomSettingsActions";
import { createTerminalActions } from "../application/terminal/terminalActions";
import { useGitHubActionsRefresh } from "./useGitHubActionsRefresh";

type AccountActionsOptions = Omit<Parameters<typeof createAccountActions>[0], "stopOwnedLocalPreviews">;
type GitWorkflowActionsOptions = Omit<Parameters<typeof createGitWorkflowActions>[0], "refreshGitHubActions">;

export function useRoomToolActions({
  settings,
  terminal,
  localPreview,
  account,
  githubActions,
  gitWorkflow,
  browser
}: {
  settings: Parameters<typeof createRoomSettingsActions>[0];
  terminal: Parameters<typeof createTerminalActions>[0];
  localPreview: Parameters<typeof createLocalPreviewActions>[0];
  account: AccountActionsOptions;
  githubActions: Parameters<typeof useGitHubActionsRefresh>[0];
  gitWorkflow: GitWorkflowActionsOptions;
  browser: Parameters<typeof createBrowserActions>[0];
}) {
  const roomSettingsActions = createRoomSettingsActions(settings);
  const terminalActions = createTerminalActions(terminal);
  const localPreviewActions = createLocalPreviewActions(localPreview);
  const accountActions = createAccountActions({
    ...account,
    stopOwnedLocalPreviews: localPreviewActions.stopOwnedLocalPreviews
  });
  const { refreshGitHubActions } = useGitHubActionsRefresh(githubActions);
  const gitWorkflowActions = createGitWorkflowActions({
    ...gitWorkflow,
    refreshGitHubActions
  });
  const browserActions = createBrowserActions(browser);

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

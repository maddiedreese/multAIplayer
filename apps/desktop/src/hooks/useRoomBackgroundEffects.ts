import { useCodexProbe } from "./useCodexProbe";
import { useGitHubActionsDraftReset } from "./useGitHubActionsDraftReset";
import { useGitHubRemoteInference } from "./useGitHubRemoteInference";
import { useLocalHistoryPersistence } from "./useLocalHistoryPersistence";
import { useLocalPreviewPolling } from "./useLocalPreviewPolling";
import { useProjectFilesSearch } from "./useProjectFilesSearch";
import { useRoomDraftCleanup } from "./useRoomDraftCleanup";
import { useRoomGitStatusRefresh } from "./useRoomGitStatusRefresh";
import { useTerminalAutoOpen } from "./useTerminalAutoOpen";
import { useTerminalLifecycle } from "./useTerminalLifecycle";

export function useRoomBackgroundEffects({
  localHistoryPersistence,
  localPreviewPolling,
  roomGitStatusRefresh,
  gitHubRemoteInference,
  gitHubActionsDraftReset,
  projectFilesSearch,
  terminalLifecycle,
  terminalAutoOpen,
  codexProbe,
  roomDraftCleanup
}: {
  localHistoryPersistence: Parameters<typeof useLocalHistoryPersistence>[0];
  localPreviewPolling: Parameters<typeof useLocalPreviewPolling>[0];
  roomGitStatusRefresh: Parameters<typeof useRoomGitStatusRefresh>[0];
  gitHubRemoteInference: Parameters<typeof useGitHubRemoteInference>[0];
  gitHubActionsDraftReset: Parameters<typeof useGitHubActionsDraftReset>[0];
  projectFilesSearch: Parameters<typeof useProjectFilesSearch>[0];
  terminalLifecycle: Parameters<typeof useTerminalLifecycle>[0];
  terminalAutoOpen: Parameters<typeof useTerminalAutoOpen>[0];
  codexProbe: Parameters<typeof useCodexProbe>[0];
  roomDraftCleanup: Parameters<typeof useRoomDraftCleanup>[0];
}) {
  useLocalHistoryPersistence(localHistoryPersistence);
  useLocalPreviewPolling(localPreviewPolling);
  useRoomGitStatusRefresh(roomGitStatusRefresh);
  useGitHubRemoteInference(gitHubRemoteInference);
  useGitHubActionsDraftReset(gitHubActionsDraftReset);
  useProjectFilesSearch(projectFilesSearch);
  useTerminalLifecycle(terminalLifecycle);
  useTerminalAutoOpen(terminalAutoOpen);
  useCodexProbe(codexProbe);
  useRoomDraftCleanup(roomDraftCleanup);
}

import { useEffect } from "react";
import { getGitRemoteOrigin } from "../lib/localBackend";
import { parseGitHubRemoteUrl } from "../lib/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { useAppStore } from "../store/appStore";

interface LatestRef<T> {
  current: T;
}

interface UseGitHubRemoteInferenceOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  selectedRoomIdRef: LatestRef<string>;
}

export function useGitHubRemoteInference({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  selectedRoomIdRef
}: UseGitHubRemoteInferenceOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (!canReadLocalWorkspace) return;
    const roomId = selectedRoomId;
    const projectPath = selectedRoomProjectPath;
    let cancelled = false;
    getGitRemoteOrigin(projectPath)
      .then((remote) => {
        if (cancelled || !remote.originUrl) return;
        const repo = parseGitHubRemoteUrl(remote.originUrl);
        if (!repo) return;
        const { applyInferredGitHubRemoteForRoom, setGitWorkflowMessageForRoom } = useAppStore.getState();
        if (!applyInferredGitHubRemoteForRoom(roomId, repo)) return;
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setGitWorkflowMessageForRoom(
            roomId,
            `Detected GitHub remote ${repo.owner}/${repo.repo} for PRs and Actions.`
          );
        }
      })
      .catch(() => {
        // Remote inference is best-effort; manual owner/repo fields remain available.
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath, selectedRoomIdRef]);
}

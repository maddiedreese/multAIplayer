import { useEffect } from "react";
import { getGitRemoteOrigin } from "../lib/platform/localBackend";
import { parseGitHubRemoteUrl } from "../lib/git/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../lib/room/roomScopedUi";
import { useAppStore } from "../store/appStore";
import { reportExpectedFailure } from "../lib/core/nonFatalReporting";

interface LatestRef<T> {
  current: T;
}

interface UseGitHubRemoteInferenceOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string | null;
  selectedRoomProjectPath: string;
  selectedRoomIdRef: LatestRef<string | null>;
}

export function useGitHubRemoteInference({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  selectedRoomIdRef
}: UseGitHubRemoteInferenceOptions) {
  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) return;
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
        reportExpectedFailure("GitHub remote inference was unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath, selectedRoomIdRef]);
}

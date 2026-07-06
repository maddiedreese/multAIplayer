import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getGitRemoteOrigin } from "../lib/localBackend";
import {
  defaultGitWorkflowDraft,
  parseGitHubRemoteUrl,
  resolveGitWorkflowDraft,
  updateGitWorkflowDraftRecord,
  type GitWorkflowDraft
} from "../lib/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";

interface LatestRef<T> {
  current: T;
}

interface UseGitHubRemoteInferenceOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  selectedRoomIdRef: LatestRef<string>;
  gitWorkflowDraftsRef: LatestRef<Record<string, Partial<GitWorkflowDraft>>>;
  setGitWorkflowDraftsByRoom: Dispatch<SetStateAction<Record<string, Partial<GitWorkflowDraft>>>>;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
}

export function useGitHubRemoteInference({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  selectedRoomIdRef,
  gitWorkflowDraftsRef,
  setGitWorkflowDraftsByRoom,
  setGitWorkflowMessageForRoom
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
        const currentDraft = resolveGitWorkflowDraft(gitWorkflowDraftsRef.current, roomId);
        const isDefaultTarget =
          currentDraft.prOwner === defaultGitWorkflowDraft.prOwner &&
          currentDraft.prRepo === defaultGitWorkflowDraft.prRepo;
        const alreadyMatches = currentDraft.prOwner === repo.owner && currentDraft.prRepo === repo.repo;
        if (!isDefaultTarget || alreadyMatches) return;
        setGitWorkflowDraftsByRoom((current) =>
          updateGitWorkflowDraftRecord(current, roomId, {
            prOwner: repo.owner,
            prRepo: repo.repo
          })
        );
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setGitWorkflowMessageForRoom(roomId, `Detected GitHub remote ${repo.owner}/${repo.repo} for PRs and Actions.`);
        }
      })
      .catch(() => {
        // Remote inference is best-effort; manual owner/repo fields remain available.
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath]);
}

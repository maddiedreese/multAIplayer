import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { GitHubActionsEventPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import {
  listGitHubActionRuns,
  type GitHubActionRun,
  type GitHubAuthConfig,
  type SignedInUser
} from "../lib/authClient";
import {
  checkGitHubActionsReadiness,
  gitHubActionsRefreshInFlightMessage,
  isGitHubActionsRefreshInFlight,
  type GitHubActionsTarget
} from "../lib/githubWorkflowReadiness";
import {
  resolveGitWorkflowDraft,
  type GitWorkflowDraft
} from "../lib/gitWorkflowDraft";
import { summarizeActionRuns } from "../lib/githubActionsSummary";
import { isLocalUserActiveHostForRoom } from "../lib/roomHost";
import { canUseLocalWorkspace, localWorkspaceGateMessage } from "../lib/workspaceAccess";
import { omitRecordKey } from "../lib/setUtils";

interface LocalUser {
  id: string;
  name: string;
}

interface UseGitHubActionsRefreshOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  roomsRef: MutableRefObject<RoomRecord[]>;
  actionsBusyRef: MutableRefObject<Record<string, boolean>>;
  gitWorkflowDraftsRef: MutableRefObject<Record<string, Partial<GitWorkflowDraft>>>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  localUser: LocalUser;
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  setActionsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionRunsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionRun[]>>>;
  setActionsLastCheckedByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  publishGitHubActionsEvent: (
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room?: RoomRecord
  ) => Promise<void>;
}

export function useGitHubActionsRefresh({
  hasSelectedRoom,
  selectedRoom,
  roomsRef,
  actionsBusyRef,
  gitWorkflowDraftsRef,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  localUser,
  authConfig,
  currentUser,
  setActionsBusyForRoom,
  setActionsMessagesByRoom,
  setActionRunsByRoom,
  setActionsLastCheckedByRoom,
  publishGitHubActionsEvent
}: UseGitHubActionsRefreshOptions) {
  async function refreshGitHubActions(roomArg?: RoomRecord, targetArg?: GitHubActionsTarget) {
    const room = roomArg ?? (hasSelectedRoom ? selectedRoom : null);
    if (!room) {
      return;
    }
    const roomId = room.id;
    if (isGitHubActionsRefreshInFlight(actionsBusyRef.current, roomId)) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: gitHubActionsRefreshInFlightMessage()
      }));
      return;
    }
    if (!roomsRef.current.some((item) => item.id === roomId)) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: "This room is no longer available for GitHub Actions refresh."
      }));
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const roomActiveHost = isLocalUserActiveHostForRoom(room, localUser);
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    if (!roomActiveHost) {
      const roomHostGateMessage =
        room.hostStatus === "active"
          ? `Only ${room.host} can refresh GitHub Actions in this room.`
          : "Claim host before refreshing GitHub Actions in this room.";
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: roomHostGateMessage
      }));
      return;
    }
    if (!roomCanReadLocalWorkspace) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: localWorkspaceGateMessage(room, roomLocked)
      }));
      return;
    }
    const workflowDraft = resolveGitWorkflowDraft(gitWorkflowDraftsRef.current, roomId);
    const readiness = checkGitHubActionsReadiness({
      authConfig,
      currentUser,
      owner: targetArg?.owner ?? workflowDraft.prOwner,
      repo: targetArg?.repo ?? workflowDraft.prRepo,
      branch: targetArg?.branch ?? workflowDraft.branchName
    });
    if (!readiness.ready) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: readiness.messages.join(" ")
      }));
      return;
    }
    const actionsTarget = readiness.normalizedTarget;
    if (!actionsTarget) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: "GitHub Actions target could not be normalized."
      }));
      return;
    }
    setActionsBusyForRoom(roomId, true);
    setActionsMessagesByRoom((current) => omitRecordKey(current, roomId));
    try {
      const result = await listGitHubActionRuns(actionsTarget.owner, actionsTarget.repo, actionsTarget.branch);
      const checkedAt = new Date().toISOString();
      setActionRunsByRoom((current) => ({
        ...current,
        [roomId]: result.runs
      }));
      setActionsLastCheckedByRoom((current) => ({
        ...current,
        [roomId]: checkedAt
      }));
      const summary = summarizeActionRuns(result.runs);
      const message = result.runs.length
        ? `Loaded ${result.runs.length} workflow runs for ${actionsTarget.branch}.`
        : `No workflow runs found for ${actionsTarget.branch}. GitHub may still be scheduling the branch.`;
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: `${summary.label}: ${message}`
      }));
      publishGitHubActionsEvent({
        owner: actionsTarget.owner,
        repo: actionsTarget.repo,
        branch: actionsTarget.branch,
        summary,
        message,
        checkedAt,
        runs: result.runs
      }, room).catch((error) => {
        console.warn("Failed to publish GitHub Actions event", error);
      });
    } catch (error) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: String(error)
      }));
    } finally {
      setActionsBusyForRoom(roomId, false);
    }
  }

  return {
    refreshGitHubActions
  };
}

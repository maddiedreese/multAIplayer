import type { MutableRefObject } from "react";
import type { GitHubActionsEventPlaintextPayload, ClientRoomRecord } from "@multaiplayer/protocol";
import { listGitHubActionRuns, type GitHubAuthConfig, type SignedInUser } from "../lib/identity/authClient";
import {
  checkGitHubActionsReadiness,
  gitHubActionsRefreshInFlightMessage,
  isGitHubActionsRefreshInFlight,
  type GitHubActionsTarget
} from "../lib/git/githubWorkflowReadiness";
import { resolveGitWorkflowDraft, type GitWorkflowDraft } from "../lib/git/gitWorkflowDraft";
import { summarizeActionRuns } from "../presentation/git/githubActionsSummary";
import { isLocalUserActiveHostForRoom } from "../lib/access/roomHost";
import { canUseLocalWorkspace, localWorkspaceGateMessage } from "../lib/access/workspaceAccess";
import { useAppStore } from "../store/appStore";
import { reportNonFatal } from "../lib/core/nonFatalReporting";

interface LocalUser {
  id: string;
  name: string;
}

interface UseGitHubActionsRefreshOptions {
  selectedRoom: ClientRoomRecord | null;
  roomsRef: MutableRefObject<ClientRoomRecord[]>;
  actionsBusyRef: MutableRefObject<Record<string, boolean>>;
  gitWorkflowDraftsRef: MutableRefObject<Record<string, Partial<GitWorkflowDraft>>>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  localUser: LocalUser;
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  publishGitHubActionsEvent: (
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room?: ClientRoomRecord
  ) => Promise<void>;
}

export function useGitHubActionsRefresh({
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
  publishGitHubActionsEvent
}: UseGitHubActionsRefreshOptions) {
  const setActionsMessageForRoom = useAppStore((state) => state.setActionsMessageForRoom);
  const recordGitHubActionsRefreshForRoom = useAppStore((state) => state.recordGitHubActionsRefreshForRoom);

  async function refreshGitHubActions(roomArg?: ClientRoomRecord, targetArg?: GitHubActionsTarget) {
    const room = roomArg ?? selectedRoom;
    if (!room) {
      return;
    }
    const roomId = room.id;
    if (isGitHubActionsRefreshInFlight(actionsBusyRef.current, roomId)) {
      setActionsMessageForRoom(roomId, gitHubActionsRefreshInFlightMessage());
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const gateMessage = githubActionsRoomGateMessage(room, roomsRef.current, localUser, roomLocked);
    if (gateMessage) {
      setActionsMessageForRoom(roomId, gateMessage);
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
      setActionsMessageForRoom(roomId, readiness.messages.join(" "));
      return;
    }
    const actionsTarget = readiness.normalizedTarget;
    if (!actionsTarget) {
      setActionsMessageForRoom(roomId, "GitHub Actions target could not be normalized.");
      return;
    }
    setActionsBusyForRoom(roomId, true);
    setActionsMessageForRoom(roomId, null);
    try {
      const result = await listGitHubActionRuns(actionsTarget.owner, actionsTarget.repo, actionsTarget.branch);
      const checkedAt = new Date().toISOString();
      const summary = summarizeActionRuns(result.runs);
      const message = result.runs.length
        ? `Loaded ${result.runs.length} workflow runs for ${actionsTarget.branch}.`
        : `No workflow runs found for ${actionsTarget.branch}. GitHub may still be scheduling the branch.`;
      recordGitHubActionsRefreshForRoom(roomId, {
        runs: result.runs,
        checkedAt,
        message: `${summary.label}: ${message}`
      });
      publishGitHubActionsEvent(
        {
          owner: actionsTarget.owner,
          repo: actionsTarget.repo,
          branch: actionsTarget.branch,
          summary,
          message,
          checkedAt,
          runs: result.runs
        },
        room
      ).catch((error) => {
        reportNonFatal("publish GitHub Actions event", error);
      });
    } catch (error) {
      setActionsMessageForRoom(roomId, String(error));
    } finally {
      setActionsBusyForRoom(roomId, false);
    }
  }

  return {
    refreshGitHubActions
  };
}

function githubActionsRoomGateMessage(
  room: ClientRoomRecord,
  rooms: ClientRoomRecord[],
  localUser: LocalUser,
  roomLocked: boolean
) {
  if (!rooms.some((item) => item.id === room.id)) {
    return "This room is no longer available for GitHub Actions refresh.";
  }
  if (!isLocalUserActiveHostForRoom(room, localUser)) {
    return room.hostStatus === "active"
      ? `Only ${room.host} can refresh GitHub Actions in this room.`
      : "Claim host before refreshing GitHub Actions in this room.";
  }
  return canUseLocalWorkspace(room, localUser, roomLocked) ? null : localWorkspaceGateMessage(room, roomLocked);
}

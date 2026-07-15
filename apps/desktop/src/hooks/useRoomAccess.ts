import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "../lib/localHistory";
import type { LocalHostUser } from "../lib/roomHost";
import { browserAccessGateMessage, canHostBrowserAction, canRequestBrowserAccess } from "../lib/browserPolicy";
import { canCreateRoomInvite } from "../lib/invitePolicy";
import { roomLockMessage } from "../lib/appRuntime";
import { isLocalUserActiveHostForRoom } from "../lib/roomHost";
import { roomPostureSummary } from "../lib/roomPosture";
import { canRequestWorkspaceAction, canUseLocalWorkspace, localWorkspaceGateMessage } from "../lib/workspaceAccess";

interface UseRoomAccessOptions {
  hasSelectedRoom: boolean;
  selectedRoom: ClientRoomRecord;
  localUser: LocalHostUser;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  historySettings: LocalHistorySettings;
  inviteApprovalGate: boolean;
}

export function useRoomAccess({
  hasSelectedRoom,
  selectedRoom,
  localUser,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  historySettings
}: UseRoomAccessOptions) {
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser);
  const isSelectedRoomForgotten = forgottenRoomIds.has(selectedRoom.id);
  const isSelectedRoomRevoked = revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId);
  const isSelectedRoomArchived = Boolean(selectedRoom.archivedAt);
  const isSelectedRoomLocked = isSelectedRoomForgotten || isSelectedRoomRevoked || isSelectedRoomArchived;
  const canReadLocalWorkspace = hasSelectedRoom && canUseLocalWorkspace(selectedRoom, localUser, isSelectedRoomLocked);
  const canRequestWorkspace = hasSelectedRoom && canRequestWorkspaceAction(selectedRoom, isSelectedRoomLocked);
  const canRequestBrowser = hasSelectedRoom && canRequestBrowserAccess(selectedRoom, isSelectedRoomLocked);
  const canHostBrowser = hasSelectedRoom && canHostBrowserAction(selectedRoom, localUser, isSelectedRoomLocked);
  const canCopyRoomInvite = hasSelectedRoom && canCreateRoomInvite(selectedRoom, localUser, isSelectedRoomLocked);
  const localWorkspaceMessage = localWorkspaceGateMessage(selectedRoom, isSelectedRoomLocked);
  const roomPosture = roomPostureSummary({
    locked: isSelectedRoomLocked,
    isActiveHost,
    canReadLocalWorkspace,
    historySettings,
    browserProfilePersistent: selectedRoom.browserProfilePersistent
  });
  const browserAccessMessage = browserAccessGateMessage(selectedRoom, isSelectedRoomLocked);
  const workspaceRequestMessage = isSelectedRoomLocked
    ? roomLockMessage(selectedRoom, isSelectedRoomRevoked)
    : "Workspace actions are available for room members to request.";
  const hostGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can approve host-side actions in this room.`
      : "Claim host before approving host-side actions in this room.";
  const roomSettingsGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can change room host settings.`
      : "Claim host before changing room host settings.";

  return {
    isActiveHost,
    isSelectedRoomForgotten,
    isSelectedRoomRevoked,
    isSelectedRoomArchived,
    isSelectedRoomLocked,
    canReadLocalWorkspace,
    canRequestWorkspace,
    canRequestBrowser,
    canHostBrowser,
    canCopyRoomInvite,
    localWorkspaceMessage,
    roomPosture,
    browserAccessMessage,
    workspaceRequestMessage,
    hostGateMessage,
    roomSettingsGateMessage
  };
}

import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "../lib/history/localHistory";
import type { LocalHostUser } from "../lib/access/roomHost";
import { browserAccessGateMessage, canHostBrowserAction, canRequestBrowserAccess } from "../lib/browser/browserPolicy";
import { canCreateRoomInvite } from "../lib/invite/invitePolicy";
import { roomLockMessage } from "../application/runtime/appRuntime";
import { isLocalUserActiveHostForRoom } from "../lib/access/roomHost";
import { roomPostureSummary } from "../lib/room/roomPosture";
import {
  canRequestWorkspaceAction,
  canUseLocalWorkspace,
  localWorkspaceGateMessage
} from "../lib/access/workspaceAccess";

interface UseRoomAccessOptions {
  hasSelectedRoom: boolean;
  selectedRoom: ClientRoomRecord | null;
  localUser: LocalHostUser;
  deviceId: string;
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
  deviceId,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  historySettings
}: UseRoomAccessOptions) {
  if (!selectedRoom) {
    return {
      isActiveHost: false,
      isSelectedRoomForgotten: false,
      isSelectedRoomRevoked: false,
      isSelectedRoomArchived: false,
      isSelectedRoomLocked: true,
      canReadLocalWorkspace: false,
      canRequestWorkspace: false,
      canRequestBrowser: false,
      canHostBrowser: false,
      canCopyRoomInvite: false,
      localWorkspaceMessage: "Select a room to use its workspace.",
      roomPosture: {
        hostAccess: "No room selected",
        workspaceAccess: "No room selected",
        history: historySettings.enabled ? `Encrypted, ${historySettings.retentionDays} days` : "Disabled",
        browserSession: "No room selected"
      },
      browserAccessMessage: "Select a room to use its browser.",
      workspaceRequestMessage: "Select a room to request workspace access.",
      hostGateMessage: "Select a room before using host controls.",
      roomSettingsGateMessage: "Select a room before changing room settings."
    };
  }
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser, deviceId);
  const isSelectedRoomForgotten = forgottenRoomIds.has(selectedRoom.id);
  const isSelectedRoomRevoked = revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId);
  const isSelectedRoomArchived = Boolean(selectedRoom.archivedAt);
  const isSelectedRoomLocked = isSelectedRoomForgotten || isSelectedRoomRevoked || isSelectedRoomArchived;
  const canReadLocalWorkspace = hasSelectedRoom && canUseLocalWorkspace(selectedRoom, localUser, isSelectedRoomLocked);
  const canRequestWorkspace = hasSelectedRoom && canRequestWorkspaceAction(selectedRoom, isSelectedRoomLocked);
  const canRequestBrowser = hasSelectedRoom && canRequestBrowserAccess(selectedRoom, isSelectedRoomLocked);
  const canHostBrowser =
    hasSelectedRoom && canHostBrowserAction(selectedRoom, localUser, deviceId, isSelectedRoomLocked);
  const canCopyRoomInvite =
    hasSelectedRoom && canCreateRoomInvite(selectedRoom, localUser, deviceId, isSelectedRoomLocked);
  const localWorkspaceMessage = localWorkspaceGateMessage(selectedRoom, isSelectedRoomLocked);
  const roomPosture = roomPostureSummary({
    locked: isSelectedRoomLocked,
    isActiveHost,
    canReadLocalWorkspace,
    historySettings
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

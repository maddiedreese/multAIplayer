import {
  approvalDelegationPolicyLabels,
  approvalPolicyLabels,
  defaultBrowserUrl,
  roomModeLabels
} from "../seedData";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomDisplayContext } from "./useAppRoomDisplayContext";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomChatMutations } from "./useRoomChatMutations";
import { useRelaySyncContext } from "./useRelaySyncContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;
type RoomDisplay = ReturnType<typeof useAppRoomDisplayContext>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomChatMutations = ReturnType<typeof useRoomChatMutations>;

export function useAppRelaySync({
  appState,
  appRefs,
  localIdentity,
  selected,
  roomActions,
  workspaceRecords,
  roomDisplay,
  inviteActions,
  roomChatMutations
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecordActions;
  roomDisplay: RoomDisplay;
  inviteActions: InviteActions;
  roomChatMutations: RoomChatMutations;
}) {
  const {
    workspaceState,
    appConfigState,
    roomRuntimeState,
    appRuntimeState,
    invitePanelState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom
  } = selected;
  const {
    appendTerminalLinesForRoom,
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendCodexEvent,
    appendLocalPreviewEvent
  } = roomActions;

  return useRelaySyncContext({
    browserOpenCommand: {
      localUser: localIdentity.localUser,
      selectedRoomIdRef: appRefs.selectedRoomIdRef,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      defaultBrowserUrl
    },
    relayRoomSync: {
      subscription: {
        relayWsUrl: appConfigState.appConfig.relayWsUrl,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        devicePublicKeyFingerprint: appRuntimeState.deviceIdentity?.publicKeyFingerprint,
        selectedTeam: workspaceState.selectedTeam,
        selectedRoom,
        hasSelectedRoom,
        inviteAdmissionsByRoom: invitePanelState.inviteAdmissionsByRoom,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        markIncomingChatUnread: workspaceState.markIncomingChatUnread,
        handleRelayError: workspaceRecords.handleRelayError,
        upsertRoom: workspaceRecords.upsertRoom,
        upsertTeam: workspaceRecords.upsertTeam,
        refreshTeamMembers: roomDisplay.refreshTeamMembers,
        decryptInviteEnvelope: inviteActions.decryptInviteEnvelope,
        handleInviteEnvelopePlaintext: inviteActions.handleInviteEnvelopePlaintext
      },
      publishers: {
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        relayStatus: appRuntimeState.relayStatus,
        selectedRoom,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        approvalPolicyLabels,
        approvalDelegationPolicyLabels,
        roomModeLabels,
        appendLocalPreviewEvent,
        appendGitWorkflowEvent,
        appendCodexEvent,
        upsertCodexActivity: roomActions.upsertCodexActivity,
        appendTerminalLinesForRoom,
        appendRoomMessage: roomChatMutations.appendRoomMessage,
        appendGitHubActionsEvent
      }
    }
  });
}

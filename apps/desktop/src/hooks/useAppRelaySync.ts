import {
  approvalPolicyLabels,
  roomModeLabels
} from "../seedData";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomDisplayContext } from "./useAppRoomDisplayContext";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useAppWorkspaceRecords } from "./useAppWorkspaceRecords";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomChatMutations } from "./useRoomChatMutations";
import { useRelaySyncContext } from "./useRelaySyncContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type WorkspaceRecords = ReturnType<typeof useAppWorkspaceRecords>;
type RoomDisplay = ReturnType<typeof useAppRoomDisplayContext>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type RoomChatMutations = ReturnType<typeof useRoomChatMutations>;

export function useAppRelaySync({
  appState,
  appRefs,
  localIdentity,
  selected,
  roomInteraction,
  roomActions,
  workspaceRecords,
  roomDisplay,
  inviteActions,
  hostHandoffActions,
  roomChatMutations
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecords;
  roomDisplay: RoomDisplay;
  inviteActions: InviteActions;
  hostHandoffActions: HostHandoffActions;
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
    appendBrowserRequest,
    updateBrowserRequestStatus,
    setBrowserMessageForRoom,
    setBrowserUrlForRoom,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendTerminalLinesForRoom,
    appendGitWorkflowEvent,
    setGitWorkflowMessageForRoom,
    appendGitHubActionsEvent,
    setActionRunsForRoom,
    setActionsLastCheckedForRoom,
    setActionsMessageForRoom,
    appendCodexEvent,
    appendLocalPreviewEvent,
    setChatMessageForRoom,
    setHostMessageForRoom,
    appendHostHandoff,
    setInviteMessageForRoom
  } = roomActions;

  return useRelaySyncContext({
    browserOpenCommand: {
      localUser: localIdentity.localUser,
      selectedRoomIdRef: appRefs.selectedRoomIdRef,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      appendBrowserRequest,
      setBrowserMessageForRoom,
      setBrowserUrlForRoom
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
        isActiveHost: roomInteraction.isActiveHost,
        inviteAdmissionsByRoom: invitePanelState.inviteAdmissionsByRoom,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        approvalPolicyLabels,
        roomModeLabels,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        setRelayStatus: appRuntimeState.setRelayStatus,
        setPresenceByRoom: roomRuntimeState.setPresenceByRoom,
        setRooms: workspaceState.setRooms,
        setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
        handleRelayError: workspaceRecords.handleRelayError,
        upsertRoom: workspaceRecords.upsertRoom,
        upsertTeam: workspaceRecords.upsertTeam,
        refreshTeamMembers: roomDisplay.refreshTeamMembers,
        decryptInviteEnvelope: inviteActions.decryptInviteEnvelope,
        handleInviteEnvelopePlaintext: inviteActions.handleInviteEnvelopePlaintext,
        applyMessageReaction: roomChatMutations.applyMessageReaction,
        appendTerminalRequest,
        updateTerminalRequestStatus,
        appendTerminalLinesForRoom,
        appendGitWorkflowEvent,
        setGitWorkflowMessageForRoom,
        appendGitHubActionsEvent,
        setActionRunsForRoom,
        setActionsLastCheckedForRoom,
        setActionsMessageForRoom,
        appendCodexEvent,
        appendBrowserRequest,
        updateBrowserRequestStatus,
        appendLocalPreviewEvent,
        setChatMessageForRoom,
        markHostHandoffAccepted: hostHandoffActions.markHostHandoffAccepted,
        setHostMessageForRoom,
        appendHostHandoff,
        appendRoomMessage: roomChatMutations.appendRoomMessage,
        setInviteMessageForRoom
      },
      publishers: {
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        relayStatus: appRuntimeState.relayStatus,
        selectedRoom,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        approvalPolicyLabels,
        roomModeLabels,
        appendLocalPreviewEvent,
        appendGitWorkflowEvent,
        appendCodexEvent,
        appendTerminalLinesForRoom,
        appendRoomMessage: roomChatMutations.appendRoomMessage,
        appendGitHubActionsEvent
      }
    }
  });
}

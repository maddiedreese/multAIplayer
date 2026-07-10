import type { useAppRefs } from "./useAppRefs";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useRoomInteractionContext } from "./useRoomInteractionContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;

export function useAppRoomInteractionContext({
  appState,
  appRefs,
  githubAuth,
  localIdentity,
  selected,
  roomActions
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomActions: RoomActions;
}) {
  const {
    workspaceState,
    roomRuntimeState,
    historyDefaultsState,
    appRuntimeState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom,
    inviteApprovalGate,
    hostMessage,
    chatMessage,
    actionRuns,
    gitWorkflowDraft
  } = selected;
  const {
    setHostMessageForRoom,
    setSettingsMessageForRoom,
    setInviteMessageForRoom,
    setFileMessageForRoom,
    setTerminalErrorForRoom
  } = roomActions;

  return useRoomInteractionContext({
    inFlightReporters: {
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      keyRotationBusyRef: appRefs.keyRotationBusyRef,
      fileBusyRef: appRefs.fileBusyRef,
      terminalBusyRef: appRefs.terminalBusyRef,
      setHostMessageForRoom,
      setSettingsMessageForRoom,
      setInviteMessageForRoom,
      setFileMessageForRoom,
      setTerminalErrorForRoom
    },
    notices: {
      roomId: selectedRoom.id,
      hostMessage,
      chatMessage
    },
    visibilityWarning: {
      hasSelectedRoom,
      selectedRoomId: selectedRoom.id
    },
    access: {
      hasSelectedRoom,
      selectedRoom,
      localUser: localIdentity.localUser,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      historySettings: historyDefaultsState.historySettings,
      inviteApprovalGate
    },
    chat: {
      hasSelectedRoom,
      selectedRoomId: workspaceState.selectedRoomId,
      selectedRoom,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      localUser: localIdentity.localUser,
      deviceId: localIdentity.deviceId,
      relayStatus: appRuntimeState.relayStatus,
      relayRef: appRefs.relayRef,
      seenEnvelopeIds: appRefs.seenEnvelopeIds,
      codexEventsByRoom: appState.codexRoomState.codexEventsByRoom
    },
    githubWorkflow: {
      actionRuns,
      authConfig: githubAuth.authConfig,
      currentUser: githubAuth.currentUser,
      gitWorkflowDraft,
      projectPath: selectedRoom.projectPath
    },
    memberRows: {
      presenceByRoom: roomRuntimeState.presenceByRoom,
      selectedRoom,
      selectedRoomId: workspaceState.selectedRoomId,
      localUser: localIdentity.localUser,
      localDeviceId: localIdentity.deviceId,
      localPublicKeyFingerprint: appRuntimeState.deviceIdentity?.publicKeyFingerprint,
      trustedDeviceKeys: appRuntimeState.trustedDeviceKeys
    }
  });
}

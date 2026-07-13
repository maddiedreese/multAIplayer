import type { useAppRefs } from "./useAppRefs";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useRoomInteractionContext } from "./useRoomInteractionContext";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";

type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;

export function useAppRoomInteractionContext({
  appRefs,
  githubAuth,
  localIdentity,
  selected,
  roomActions
}: {
  appRefs: AppRefs;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomActions: RoomActions;
}) {
  const { hasSelectedRoom, selectedRoom, inviteApprovalGate, hostMessage, chatMessage, actionRuns, gitWorkflowDraft } =
    selected;
  const {
    setHostMessageForRoom,
    setSettingsMessageForRoom,
    setInviteMessageForRoom,
    setFileMessageForRoom,
    setTerminalErrorForRoom
  } = roomActions;
  const {
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    roomPresence,
    selectedRoomId,
    deviceIdentity,
    trustedDeviceKeys
  } = useAppStore(
    useShallow((state) => ({
      forgottenRoomIds: state.forgottenRoomIds,
      revokedRoomIds: state.revokedRoomIds,
      revokedTeamIds: state.revokedTeamIds,
      historySettings: state.historySettings,
      roomPresence: state.historyPresenceByRoom[selectedRoom.id]?.presence,
      selectedRoomId: state.selectedRoomId,
      deviceIdentity: state.deviceIdentity,
      trustedDeviceKeys: state.trustedDeviceKeys
    }))
  );

  return useRoomInteractionContext({
    inFlightReporters: {
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      membershipCommitBusyRef: appRefs.membershipCommitBusyRef,
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
    access: {
      hasSelectedRoom,
      selectedRoom,
      localUser: localIdentity.localUser,
      forgottenRoomIds,
      revokedRoomIds,
      revokedTeamIds,
      historySettings,
      inviteApprovalGate
    },
    chat: {
      relayRef: appRefs.relayRef,
      seenEnvelopeIds: appRefs.seenEnvelopeIds
    },
    githubWorkflow: {
      actionRuns,
      authConfig: githubAuth.authConfig,
      currentUser: githubAuth.currentUser,
      gitWorkflowDraft,
      projectPath: selectedRoom.projectPath
    },
    memberRows: {
      presenceByRoom: roomPresence ? { [selectedRoom.id]: roomPresence } : {},
      selectedRoom,
      selectedRoomId,
      localUser: localIdentity.localUser,
      localDeviceId: localIdentity.deviceId,
      localPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
      trustedDeviceKeys
    }
  });
}

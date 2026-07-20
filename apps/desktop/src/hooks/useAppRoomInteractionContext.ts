import type { useAppRefs } from "./useAppRefs";
import type { createRoomActions } from "../application/rooms/roomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { createChatActions } from "../application/chat/chatActions";
import { acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement } from "../lib/history/roomVisibilityWarning";
import { buildRoomMemberRows } from "../presentation/roster/rosterDisplayRows";
import { useAppStore } from "../store/appStore";
import { buildRoomNotices } from "./roomNotices";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useRoomAccess } from "./useRoomAccess";
import { useRoomInFlightReporters } from "./useRoomInFlightReporters";
import { useShallow } from "zustand/react/shallow";

type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof createRoomActions>;

export function acknowledgeSelectedRoomVisibilityWarning() {
  const { selectedRoomId } = useAppStore.getState();
  if (!selectedRoomId) return;
  saveRoomVisibilityWarningAcknowledgement(selectedRoomId);
  useAppStore.getState().setSecretWarningVisibleForRoom(selectedRoomId, false);
}

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
    deviceIdentity,
    deviceFingerprintComparisons
  } = useAppStore(
    useShallow((state) => ({
      forgottenRoomIds: state.forgottenRoomIds,
      revokedRoomIds: state.revokedRoomIds,
      revokedTeamIds: state.revokedTeamIds,
      historySettings: state.historySettings,
      roomPresence: selectedRoom ? state.historyPresenceByRoom[selectedRoom.id]?.presence : undefined,
      deviceIdentity: state.deviceIdentity,
      deviceFingerprintComparisons: state.deviceFingerprintComparisons
    }))
  );

  const reporters = useRoomInFlightReporters({
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
  });
  const roomNotices = buildRoomNotices({ roomId: selectedRoom?.id ?? null, hostMessage, chatMessage });
  const accessState = useRoomAccess({
    hasSelectedRoom,
    selectedRoom,
    localUser: localIdentity.localUser,
    deviceId: localIdentity.deviceId,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    inviteApprovalGate
  });
  const chatActions = createChatActions({ relayRef: appRefs.relayRef, seenEnvelopeIds: appRefs.seenEnvelopeIds });
  const githubWorkflowState = useGitHubWorkflowState({
    actionRuns,
    authConfig: githubAuth.authConfig,
    currentUser: githubAuth.currentUser,
    gitWorkflowDraft,
    projectPath: selectedRoom?.projectPath ?? ""
  });
  const roomMemberRows = selectedRoom
    ? buildRoomMemberRows({
        presence: roomPresence ?? {},
        room: selectedRoom,
        localUser: localIdentity.localUser,
        localDeviceId: localIdentity.deviceId,
        ...(deviceIdentity?.publicKeyFingerprint
          ? { localPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint }
          : {}),
        deviceFingerprintComparisons
      })
    : [];

  return {
    ...reporters,
    roomNotices,
    acknowledgeRoomVisibilityWarning: acknowledgeSelectedRoomVisibilityWarning,
    ...accessState,
    ...chatActions,
    ...githubWorkflowState,
    roomMemberRows
  };
}

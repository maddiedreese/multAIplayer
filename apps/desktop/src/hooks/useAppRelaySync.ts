import {
  approvalDelegationPolicyLabels,
  approvalPolicyLabels,
  defaultBrowserUrl,
  roomModeLabels
} from "../seedData";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomChatMutations } from "./useRoomChatMutations";
import { useRelaySyncContext } from "./useRelaySyncContext";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { useTeamMembersRefresh } from "./useTeamMembersRefresh";

type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomChatMutations = ReturnType<typeof useRoomChatMutations>;

export function useAppRelaySync({
  appRefs,
  localIdentity,
  selected,
  roomActions,
  workspaceRecords,
  inviteActions,
  roomChatMutations
}: {
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecordActions;
  inviteActions: InviteActions;
  roomChatMutations: RoomChatMutations;
}) {
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
  const {
    relayWsUrl, relayHttpUrl, selectedTeam, devicePublicKeyFingerprint, relayStatus,
    forgottenRoomIds, revokedRoomIds, revokedTeamIds, selectedInviteAdmission
  } = useAppStore(useShallow((state) => ({
    relayWsUrl: state.appConfig.relayWsUrl,
    relayHttpUrl: state.appConfig.relayHttpUrl,
    selectedTeam: state.selectedTeam,
    devicePublicKeyFingerprint: state.deviceIdentity?.publicKeyFingerprint,
    relayStatus: state.relayStatus,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    selectedInviteAdmission: state.inviteByRoom[selectedRoom.id]?.admission
  })));
  const { refreshTeamMembers } = useTeamMembersRefresh({ selectedTeam, relayHttpUrl });

  return useRelaySyncContext({
    browserOpenCommand: {
      localUser: localIdentity.localUser,
      selectedRoomIdRef: appRefs.selectedRoomIdRef,
      forgottenRoomIds,
      revokedRoomIds,
      revokedTeamIds,
      defaultBrowserUrl
    },
    relayRoomSync: {
      subscription: {
        relayWsUrl,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        devicePublicKeyFingerprint,
        selectedTeam,
        selectedRoom,
        hasSelectedRoom,
        inviteAdmissionsByRoom: selectedInviteAdmission ? { [selectedRoom.id]: selectedInviteAdmission } : {},
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        markIncomingChatUnread: (...args) => useAppStore.getState().markIncomingChatUnread(...args),
        handleRelayError: workspaceRecords.handleRelayError,
        upsertRoom: workspaceRecords.upsertRoom,
        upsertTeam: workspaceRecords.upsertTeam,
        refreshTeamMembers,
        decryptInviteEnvelope: inviteActions.decryptInviteEnvelope,
        handleInviteEnvelopePlaintext: inviteActions.handleInviteEnvelopePlaintext
      },
      publishers: {
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        relayStatus,
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

import { approvalPolicyLabels } from "../appDefaults";
import type { InviteActions } from "./useInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createRoomActions } from "../application/rooms/roomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { WorkspaceRecordActions } from "../application/workspace/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { useAppBootstrapEffects } from "./useAppBootstrapEffects";
import { createMarkdownCopyActions } from "../application/markdown/markdownCopyActions";
import { useHistorySearch } from "./useHistorySearch";
import { useLocalHistoryHydration } from "./useLocalHistoryHydration";
import { createFileActions } from "../application/files/fileActions";
import { createLocalHistoryActions } from "../application/history/localHistoryActions";
import { createMemberActions } from "../application/members/memberActions";
import { createTeamDefaultActions } from "../application/teams/teamDefaultActions";
import { createWorkspaceCreationActions } from "../application/workspace/workspaceCreationActions";

type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createRoomActions>;
type RoomSettingsActor = () => { requesterName: string; requesterUserId: string };

export type WorkspaceFlow = ReturnType<typeof useAppWorkspaceFlow>;

export function useAppWorkspaceFlow({
  appRefs,
  identityResolved,
  authenticatedUserId,
  localIdentity,
  selected,
  roomInteraction,
  roomActions,
  workspaceRecords,
  inviteActions,
  roomSettingsActor
}: {
  appRefs: AppRefs;
  identityResolved: boolean;
  authenticatedUserId: string | null;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecordActions;
  inviteActions: InviteActions;
  roomSettingsActor: RoomSettingsActor;
}) {
  const {
    relayHttpUrl,
    selectedRoomId,
    selectedTeam,
    deviceIdentity,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    rooms,
    searchActive,
    workspaceBootstrapAttempt
  } = useAppStore(
    useShallow((state) => ({
      relayHttpUrl: state.appConfig.relayHttpUrl,
      selectedRoomId: state.selectedRoomId,
      selectedTeam: state.selectedTeam,
      deviceIdentity: state.deviceIdentity,
      forgottenRoomIds: state.forgottenRoomIds,
      revokedRoomIds: state.revokedRoomIds,
      revokedTeamIds: state.revokedTeamIds,
      rooms: state.rooms,
      searchActive: Boolean(state.sidebarQuery.trim()),
      workspaceBootstrapAttempt: state.workspaceBootstrapAttempt
    }))
  );
  const { hasSelectedRoom, selectedRoom } = selected;
  const { setSelectedTeamHistoryMessage, setTeamHistoryMessageForTeam, hydrateLocalRoomHistoryForRoom } = roomActions;
  const actions = useAppStore.getState();

  const flow = {
    bootstrap: {
      workspace: {
        relayHttpUrl,
        authenticatedUserId,
        bootstrapAttempt: workspaceBootstrapAttempt,
        replaceTeams: actions.replaceTeams,
        replaceRooms: actions.replaceRooms,
        selectExistingTeamOrFirst: actions.selectExistingTeamOrFirst,
        selectExistingRoomOrFirst: actions.selectExistingRoomOrFirst,
        setWorkspaceStatusError: actions.setWorkspaceStatusError,
        beginWorkspaceBootstrap: actions.beginWorkspaceBootstrap,
        completeWorkspaceBootstrap: actions.completeWorkspaceBootstrap,
        failWorkspaceBootstrap: actions.failWorkspaceBootstrap
      },
      selectedRoomReadReceipt: {
        selectedRoomId,
        markRoomRead: actions.markRoomReadById
      },
      deviceIdentity: {
        relayHttpUrl,
        identityResolved,
        deviceId: localIdentity.deviceId,
        replaceDeviceId: localIdentity.replaceDeviceId,
        userId: localIdentity.localUser.id,
        displayName: localIdentity.localUser.name,
        deviceIdentity,
        replaceDeviceIdentity: actions.replaceDeviceIdentity,
        setDeviceIdentityStatusMessage: actions.setDeviceIdentityStatusMessage
      },
      selectedTeamDefaults: {
        selectedTeam
      }
    },
    workspaceRoomActions: {
      members: {
        setDeviceIdentityMessage: actions.setDeviceIdentityStatusMessage,
        recordDeviceFingerprintComparisonForRoom: actions.recordDeviceFingerprintComparisonForRoom,
        removeDeviceFingerprintComparisonForRoom: actions.removeDeviceFingerprintComparisonForRoom,
        updateTeamRoleForTeam: actions.updateTeamRoleForTeam,
        updateTeamMemberCountForTeam: actions.updateTeamMemberCountForTeam,
        removeMembersFromMlsGroup: inviteActions.removeMembersFromMlsGroup
      },
      workspaceCreation: {
        setWorkspaceStatusError: actions.setWorkspaceStatusError,
        setSelectedTeam: actions.setSelectedTeam,
        setSelectedRoomId: actions.setSelectedRoomId,
        setNewTeamName: actions.setNewTeamName,
        setNewRoomName: actions.setNewRoomName,
        setNewRoomProjectPath: actions.setNewRoomProjectPath,
        upsertTeam: workspaceRecords.upsertTeam,
        upsertRoom: workspaceRecords.upsertRoom,
        roomSettingsActor
      },
      teamDefaults: {
        approvalPolicyLabels,
        setSelectedTeamHistoryMessage,
        setTeamHistoryMessageForTeam,
        setTeamHistorySettings: actions.setTeamHistorySettings,
        setTeamDefaultApprovalPolicy: actions.setTeamDefaultApprovalPolicy,
        setTeamDefaultCodexModel: actions.setTeamDefaultCodexModel,
        setTeamDefaultInviteApprovalGate: actions.setTeamDefaultInviteApprovalGate
      },
      localHistory: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        settingsBusyRef: appRefs.settingsBusyRef,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        replaceHistorySettings: actions.setHistorySettings,
        replaceRoom: workspaceRecords.replaceRoom
      },
      files: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        reportRoomFileActionInFlight: roomInteraction.reportRoomFileActionInFlight
      }
    },
    historyEffects: {
      hydration: {
        hasSelectedRoom,
        selectedRoomId,
        selectedRoomTeamId: selectedRoom?.teamId ?? "",
        forgottenRoomIds,
        replaceHistorySettings: actions.setHistorySettings,
        hydrateLocalRoomHistoryForRoom,
        hydrateRoomReadState: actions.hydrateRoomReadState
      },
      search: {
        searchActive,
        rooms,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        startHistorySearch: actions.startHistorySearch,
        finishHistorySearch: actions.finishHistorySearch
      }
    }
  };
  useAppBootstrapEffects(flow.bootstrap);
  const markdownCopyActions = createMarkdownCopyActions();
  const memberActions = createMemberActions({
    ...flow.workspaceRoomActions.members,
    copyMarkdownWithFallback: markdownCopyActions.copyMarkdownWithFallback
  });
  useLocalHistoryHydration(flow.historyEffects.hydration);
  useHistorySearch(flow.historyEffects.search);

  return {
    ...markdownCopyActions,
    ...memberActions,
    ...createWorkspaceCreationActions(flow.workspaceRoomActions.workspaceCreation),
    ...createTeamDefaultActions(flow.workspaceRoomActions.teamDefaults),
    ...createLocalHistoryActions(flow.workspaceRoomActions.localHistory),
    ...createFileActions(flow.workspaceRoomActions.files)
  };
}

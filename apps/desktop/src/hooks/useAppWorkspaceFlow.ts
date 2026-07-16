import { approvalPolicyLabels } from "../appDefaults";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createAppRoomActions } from "./appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { WorkspaceRecordActions } from "../application/workspace/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { createRoomSettingsActor } from "../application/workspace/roomSettingsActor";
import { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";

type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomSettingsActor = ReturnType<typeof createRoomSettingsActor>;

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

  return useWorkspaceFlowContext({
    bootstrap: {
      workspace: {
        relayHttpUrl,
        authenticatedUserId,
        bootstrapAttempt: workspaceBootstrapAttempt,
        replaceTeams: storeAction("replaceTeams"),
        replaceRooms: storeAction("replaceRooms"),
        selectExistingTeamOrFirst: storeAction("selectExistingTeamOrFirst"),
        selectExistingRoomOrFirst: storeAction("selectExistingRoomOrFirst"),
        setWorkspaceStatusError: storeAction("setWorkspaceStatusError"),
        beginWorkspaceBootstrap: storeAction("beginWorkspaceBootstrap"),
        completeWorkspaceBootstrap: storeAction("completeWorkspaceBootstrap"),
        failWorkspaceBootstrap: storeAction("failWorkspaceBootstrap")
      },
      selectedRoomReadReceipt: {
        selectedRoomId,
        markRoomRead: storeAction("markRoomReadById")
      },
      deviceIdentity: {
        relayHttpUrl,
        identityResolved,
        deviceId: localIdentity.deviceId,
        userId: localIdentity.localUser.id,
        displayName: localIdentity.localUser.name,
        deviceIdentity,
        replaceDeviceIdentity: storeAction("replaceDeviceIdentity"),
        setDeviceIdentityStatusMessage: storeAction("setDeviceIdentityStatusMessage")
      },
      selectedTeamDefaults: {
        selectedTeam
      }
    },
    workspaceRoomActions: {
      members: {
        setDeviceIdentityMessage: storeAction("setDeviceIdentityStatusMessage"),
        trustDeviceForRoom: storeAction("trustDeviceForRoom"),
        untrustDeviceForRoom: storeAction("untrustDeviceForRoom"),
        updateTeamRoleForTeam: storeAction("updateTeamRoleForTeam"),
        updateTeamMemberCountForTeam: storeAction("updateTeamMemberCountForTeam"),
        removeMembersFromMlsGroup: inviteActions.removeMembersFromMlsGroup
      },
      workspaceCreation: {
        setWorkspaceStatusError: storeAction("setWorkspaceStatusError"),
        setSelectedTeam: storeAction("setSelectedTeam"),
        setSelectedRoomId: storeAction("setSelectedRoomId"),
        setNewTeamName: storeAction("setNewTeamName"),
        setNewRoomName: storeAction("setNewRoomName"),
        setNewRoomProjectPath: storeAction("setNewRoomProjectPath"),
        upsertTeam: workspaceRecords.upsertTeam,
        upsertRoom: workspaceRecords.upsertRoom,
        roomSettingsActor
      },
      teamDefaults: {
        approvalPolicyLabels,
        setSelectedTeamHistoryMessage,
        setTeamHistoryMessageForTeam,
        setTeamHistorySettings: storeAction("setTeamHistorySettings"),
        setTeamDefaultApprovalPolicy: storeAction("setTeamDefaultApprovalPolicy"),
        setTeamDefaultCodexModel: storeAction("setTeamDefaultCodexModel"),
        setTeamDefaultBrowserProfilePersistent: storeAction("setTeamDefaultBrowserProfilePersistent"),
        setTeamDefaultInviteApprovalGate: storeAction("setTeamDefaultInviteApprovalGate")
      },
      localHistory: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        settingsBusyRef: appRefs.settingsBusyRef,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        replaceHistorySettings: storeAction("setHistorySettings"),
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
        replaceHistorySettings: storeAction("setHistorySettings"),
        hydrateLocalRoomHistoryForRoom,
        hydrateRoomReadState: storeAction("hydrateRoomReadState")
      },
      search: {
        searchActive,
        rooms,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        startHistorySearch: storeAction("startHistorySearch"),
        finishHistorySearch: storeAction("finishHistorySearch")
      }
    }
  });
}

type AppStore = ReturnType<typeof useAppStore.getState>;
type StoreActionKey = {
  [K in keyof AppStore]: AppStore[K] extends (...args: never[]) => unknown ? K : never;
}[keyof AppStore];

const cachedStoreActions = new Map<StoreActionKey, AppStore[StoreActionKey]>();

function storeAction<K extends StoreActionKey>(key: K): AppStore[K] {
  const cached = cachedStoreActions.get(key);
  if (cached) return cached as AppStore[K];
  const action = ((...args: unknown[]) => {
    const action = useAppStore.getState()[key] as (...values: unknown[]) => unknown;
    return action(...args);
  }) as AppStore[K];
  cachedStoreActions.set(key, action);
  return action;
}

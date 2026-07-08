import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useAppWorkspaceRecords } from "./useAppWorkspaceRecords";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomSettingsActor } from "./useRoomSettingsActor";
import { useHostHandoffActions } from "./useHostHandoffActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type WorkspaceRecords = ReturnType<typeof useAppWorkspaceRecords>;
type RoomSettingsActor = ReturnType<typeof useRoomSettingsActor>;

export function useAppHostHandoffActions({
  appState,
  appRefs,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  workspaceRecords,
  roomSettingsActor
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecords;
  roomSettingsActor: RoomSettingsActor;
}) {
  const {
    workspaceState,
    roomSettingsState,
    roomRuntimeState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom,
    messages,
    gitStatus
  } = selected;
  const {
    setHostBusyForRoom,
    setHostMessageForRoom,
    setSelectedHostMessage,
    setSettingsMessageForRoom,
    setProjectPathDraftForRoom,
    setCustomCodexModelForRoom,
    resetFileContextForRoom,
    resetCodexApprovalForRoom,
    appendHostHandoff
  } = roomActions;

  return useHostHandoffActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef: appRefs.selectedRoomIdRef,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
    isActiveHost: roomInteraction.isActiveHost,
    hostGateMessage: roomInteraction.hostGateMessage,
    hostHandoffs: selectedRuntime.hostHandoffs,
    queuedCodexTurns: selectedRuntime.queuedCodexApprovals,
    localUser: localIdentity.localUser,
    deviceId: localIdentity.deviceId,
    relayStatus: appRuntimeState.relayStatus,
    relayRef: appRefs.relayRef,
    seenEnvelopeIds: appRefs.seenEnvelopeIds,
    messages,
    terminals: terminalPanelState.terminals,
    browserRequestsByRoom: browserPanelState.browserRequestsByRoom,
    gitStatus,
    gitStatusByRoom: githubWorkflowPanelState.gitStatusByRoom,
    reportRoomHostMutationInFlight: roomInteraction.reportRoomHostMutationInFlight,
    roomSettingsActor,
    replaceRoom: workspaceRecords.replaceRoom,
    setHostBusyForRoom,
    setHostMessageForRoom,
    setSelectedHostMessage,
    setSettingsMessageForRoom,
    setProjectPathDraftForRoom,
    setCustomCodexModelForRoom,
    resetFileContextForRoom,
    resetCodexApprovalForRoom,
    appendHostHandoff
  });
}

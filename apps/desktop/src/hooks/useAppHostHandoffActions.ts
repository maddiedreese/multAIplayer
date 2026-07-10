import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomSettingsActor } from "./useRoomSettingsActor";
import { useHostHandoffActions } from "./useHostHandoffActions";
import { useAppStore } from "../store/appStore";

type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;
type RoomSettingsActor = ReturnType<typeof useRoomSettingsActor>;

export function useAppHostHandoffActions({
  appRefs,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  workspaceRecords,
  roomSettingsActor
}: {
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecordActions;
  roomSettingsActor: RoomSettingsActor;
}) {
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
  const relayStatus = useAppStore((state) => state.relayStatus);
  const terminals = useAppStore((state) => state.terminals);
  const browserRequests = useAppStore((state) => state.browserByRoom[selectedRoom.id]?.requests);
  const roomGitStatus = useAppStore((state) => state.gitWorkflowRuntimeByRoom[selectedRoom.id]?.workflow?.status);

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
    relayStatus,
    relayRef: appRefs.relayRef,
    seenEnvelopeIds: appRefs.seenEnvelopeIds,
    messages,
    terminals,
    browserRequestsByRoom: browserRequests ? { [selectedRoom.id]: browserRequests } : {},
    gitStatus,
    gitStatusByRoom: roomGitStatus ? { [selectedRoom.id]: roomGitStatus } : {},
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

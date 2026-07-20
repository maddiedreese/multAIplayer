import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createRoomActions } from "../application/rooms/roomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { SelectedRoomRuntime } from "./useSelectedRoomRuntime";
import type { WorkspaceRecordActions } from "../application/workspace/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useHostHandoffActions } from "./useHostHandoffActions";
import { useAppStore } from "../store/appStore";
import { isLocalUserActiveHostForRoom } from "../lib/access/roomHost";

type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createRoomActions>;
type RoomSettingsActor = () => { requesterName: string; requesterUserId: string };

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
  const { selectedRoom, messages, gitStatus } = selected;
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
  const deviceSessionToken = useAppStore((state) => state.deviceSessionToken ?? "");
  const terminals = useAppStore((state) => state.terminals);
  const browserRequests = useAppStore((state) =>
    selectedRoom ? state.browserByRoom[selectedRoom.id]?.requests : undefined
  );

  return useHostHandoffActions({
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
    deviceSessionToken,
    relayStatus,
    relayRef: appRefs.relayRef,
    seenEnvelopeIds: appRefs.seenEnvelopeIds,
    messages,
    terminals,
    browserRequests: browserRequests ?? [],
    gitStatus,
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
    appendHostHandoff,
    getHostHandoffSnapshot: () => {
      const state = useAppStore.getState();
      const room = state.rooms.find((candidate) => candidate.id === state.selectedRoomId) ?? null;
      return {
        selectedRoomId: state.selectedRoomId,
        room,
        isActiveHost: room
          ? isLocalUserActiveHostForRoom(room, localIdentity.localUser, localIdentity.deviceId)
          : false,
        hostHandoffs: room ? (state.codexRuntimeByRoom[room.id]?.hostHandoffs ?? []) : []
      };
    }
  });
}

import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useSelectedRoomRuntime } from "./useSelectedRoomRuntime";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;

export function useAppSelectedRoomRuntime({
  appState,
  localIdentity,
  selected,
  roomInteraction
}: {
  appState: AppStateSlices;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomInteraction: RoomInteraction;
}) {
  const {
    workspaceState,
    roomSettingsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    terminalPanelState,
    invitePanelState
  } = appState;
  const {
    selectedRoom,
    markdownSelectionMode,
    selectedMessageIds,
    messages,
    replyToMessageId,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId
  } = selected;

  return useSelectedRoomRuntime({
    selectedRoom,
    selectedRoomId: workspaceState.selectedRoomId,
    markdownSelectionMode,
    selectedMessageIds,
    localUser: localIdentity.localUser,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    messages,
    replyToMessageId,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId,
    pendingCodexApprovalsByRoom: codexRoomState.pendingCodexApprovalsByRoom,
    queuedCodexApprovalsByRoom: codexRoomState.queuedCodexApprovalsByRoom,
    approvalVisibleByRoom: codexRoomState.approvalVisibleByRoom,
    hostHandoffsByRoom: roomRuntimeState.hostHandoffsByRoom,
    terminalRequestsByRoom: terminalPanelState.terminalRequestsByRoom,
    localPreviewsByRoom: localPreviewState.localPreviewsByRoom,
    localPreviewBusyByRoom: localPreviewState.localPreviewBusyByRoom,
    inviteRequestsByRoom: invitePanelState.inviteRequestsByRoom,
    codexEventsByRoom: codexRoomState.codexEventsByRoom,
    codexActivitiesByRoom: codexRoomState.codexActivitiesByRoom,
    gitWorkflowEventsByRoom: roomRuntimeState.gitWorkflowEventsByRoom,
    githubActionsEventsByRoom: roomRuntimeState.githubActionsEventsByRoom,
    codexThreadIdsByRoom: codexRoomState.codexThreadIdsByRoom,
    codexThreadGraphsByRoom: codexRoomState.codexThreadGraphsByRoom,
    codexRunningByRoom: codexRoomState.codexRunningByRoom,
    hostBusyByRoom: roomSettingsState.hostBusyByRoom,
    settingsBusyByRoom: roomSettingsState.settingsBusyByRoom,
    keyRotationBusyByRoom: invitePanelState.keyRotationBusyByRoom
  });
}

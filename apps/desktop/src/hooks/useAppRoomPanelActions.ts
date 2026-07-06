import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomScopedSetters } from "./useAppRoomScopedSetters";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";
import { useRoomPanelActions } from "./useRoomPanelActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomSetters = ReturnType<typeof useAppRoomScopedSetters>;
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;

export function useAppRoomPanelActions({
  appState,
  selected,
  selectedRuntime,
  roomInteraction,
  roomSetters,
  roomRuntime,
  workspaceFlow
}: {
  appState: AppStateSlices;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomSetters: RoomSetters;
  roomRuntime: RoomRuntime;
  workspaceFlow: WorkspaceFlow;
}) {
  const {
    workspaceState,
    roomRuntimeState,
    roomChatState
  } = appState;
  const {
    selectedRoom,
    messages,
    activeBrowserUrl
  } = selected;
  const {
    setPendingCodexApprovalForRoom,
    setApprovalVisibleForRoom,
    setChatMessageForRoom,
    setDraftForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalInputForRoom,
    setFileQueryForRoom,
    setFilePreviewTabForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom
  } = roomSetters;

  return useRoomPanelActions({
    chat: {
      selectedRoomId: selectedRoom.id,
      messages,
      localPreviews: selectedRuntime.localPreviews,
      copyMessageMarkdown: workspaceFlow.copyMessageMarkdown,
      copyCodexOutputMarkdown: workspaceFlow.copyCodexOutputMarkdown,
      openEncryptedAttachmentBlob: workspaceFlow.openEncryptedAttachmentBlob,
      toggleMessageReaction: roomInteraction.toggleMessageReaction,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      approveCodexTurn: roomRuntime.approveCodexTurn,
      handleCodexInvoke: roomRuntime.handleCodexInvoke,
      copyMarkdownWithFallback: workspaceFlow.copyMarkdownWithFallback,
      setChatMessageForRoom,
      stopLocalPreview: roomRuntime.stopLocalPreview,
      setDraftForRoom
    },
    header: {
      rooms: workspaceState.rooms,
      selectedRoomId: workspaceState.selectedRoomId,
      selectedRoomIdForTabs: selectedRoom.id,
      activeBrowserUrl,
      setSelectedTeam: workspaceState.setSelectedTeam,
      setSelectedRoomId: workspaceState.setSelectedRoomId,
      setInspectorTabsByRoom: roomRuntimeState.setInspectorTabsByRoom,
      openRoomBrowserNow: roomRuntime.openRoomBrowserNow
    },
    terminal: {
      selectedRoomId: selectedRoom.id,
      terminalRequests: selectedRuntime.terminalRequests,
      copyTerminalMarkdown: workspaceFlow.copyTerminalMarkdown,
      runApprovedTerminalCheck: roomRuntime.runApprovedTerminalCheck,
      openInteractiveTerminal: roomRuntime.openInteractiveTerminal,
      setTerminalNameForRoom,
      setTerminalCommandForRoom,
      startNamedTerminal: roomRuntime.startNamedTerminal,
      requestTerminalCommand: roomRuntime.requestTerminalCommand,
      approveTerminalRequest: roomRuntime.approveTerminalRequest,
      denyTerminalRequest: roomRuntime.denyTerminalRequest,
      setSelectedTerminalIdForRoom,
      setTerminalInputForRoom,
      sendTerminalInput: roomRuntime.sendTerminalInput,
      restartSelectedTerminal: roomRuntime.restartSelectedTerminal,
      stopSelectedTerminal: roomRuntime.stopSelectedTerminal
    },
    workspaceFiles: {
      selectedRoomId: selectedRoom.id,
      copyProjectMarkdown: workspaceFlow.copyProjectMarkdown,
      setFileQueryForRoom,
      openProjectFile: workspaceFlow.openProjectFile,
      copyDiffSummaryMarkdown: workspaceFlow.copyDiffSummaryMarkdown,
      attachSelectedFileToMessage: workspaceFlow.attachSelectedFileToMessage,
      setFilePreviewTabForRoom,
      setSelectedFileForRoom,
      setSelectedDiffForRoom,
      setSensitiveAttachmentReviewKey: roomChatState.setSensitiveAttachmentReviewKey
    }
  });
}

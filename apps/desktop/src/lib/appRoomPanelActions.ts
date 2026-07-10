import type { useAppRoomInteractionContext } from "../hooks/useAppRoomInteractionContext";
import type { useAppSelectedRoomContext } from "../hooks/useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "../hooks/useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "../hooks/useAppStateSlices";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useAppRelaySync } from "../hooks/useAppRelaySync";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";
import { createRoomPanelActions } from "./roomPanelActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;

export function createAppRoomPanelActions({
  appState,
  selected,
  selectedRuntime,
  roomInteraction,
  roomRuntime,
  relaySync,
  workspaceFlow
}: {
  appState: AppStateSlices;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomRuntime: RoomRuntime;
  relaySync: RelaySync;
  workspaceFlow: WorkspaceFlow;
}) {
  const { workspaceState } = appState;
  const { selectedRoom, messages, activeBrowserUrl } = selected;
  return createRoomPanelActions({
    chat: {
      selectedRoomId: selectedRoom.id,
      messages,
      localPreviews: selectedRuntime.localPreviews,
      copyMessageMarkdown: workspaceFlow.copyMessageMarkdown,
      copyCodexOutputMarkdown: workspaceFlow.copyCodexOutputMarkdown,
      openEncryptedAttachmentBlob: workspaceFlow.openEncryptedAttachmentBlob,
      toggleMessageReaction: roomInteraction.toggleMessageReaction,
      publishChatMessageEdit: roomInteraction.publishChatMessageEdit,
      publishChatMessageDelete: roomInteraction.publishChatMessageDelete,
      publishChatMessage: roomInteraction.publishChatMessage,
      promoteNextCodexApprovalForRoom: roomRuntime.promoteNextCodexApprovalForRoom,
      approveCodexTurn: roomRuntime.approveCodexTurn,
      handleCodexInvoke: roomRuntime.handleCodexInvoke,
      activeCodexApproval: selectedRuntime.activeCodexApproval,
      publishCodexQueueEvent: relaySync.publishCodexQueueEvent,
      selectedRoom,
      pauseGoal: roomRuntime.pauseGoal,
      resumeGoal: roomRuntime.resumeGoal,
      editGoal: roomRuntime.editGoal,
      deleteGoal: roomRuntime.deleteGoal,
      tickGoalElapsed: roomRuntime.tickGoalElapsed,
      copyMarkdownWithFallback: workspaceFlow.copyMarkdownWithFallback,
      stopLocalPreview: roomRuntime.stopLocalPreview,
      openBrowserUrl: roomRuntime.openRoomBrowserForUrl
    },
    header: {
      selectedRoomId: workspaceState.selectedRoomId,
      selectedRoomIdForTabs: selectedRoom.id,
      activeBrowserUrl,
      selectTeamRoom: workspaceState.selectTeamRoom,
      openRoomBrowserNow: roomRuntime.openRoomBrowserNow
    },
    terminal: {
      selectedRoomId: selectedRoom.id,
      terminalRequests: selectedRuntime.terminalRequests,
      copyTerminalMarkdown: workspaceFlow.copyTerminalMarkdown,
      openInteractiveTerminal: roomRuntime.openInteractiveTerminal,
      approveTerminalRequest: roomRuntime.approveTerminalRequest,
      denyTerminalRequest: roomRuntime.denyTerminalRequest,
      sendTerminalData: roomRuntime.sendTerminalData,
      restartSelectedTerminal: roomRuntime.restartSelectedTerminal,
      stopSelectedTerminal: roomRuntime.stopSelectedTerminal
    },
    workspaceFiles: {
      selectedRoomId: selectedRoom.id,
      copyProjectMarkdown: workspaceFlow.copyProjectMarkdown,
      openProjectFile: workspaceFlow.openProjectFile,
      copyDiffSummaryMarkdown: workspaceFlow.copyDiffSummaryMarkdown,
      attachSelectedFileToMessage: workspaceFlow.attachSelectedFileToMessage,
      saveSelectedFileContent: workspaceFlow.saveSelectedFileContent,
      approveFileSaveRequest: workspaceFlow.approveFileSaveRequest,
      denyFileSaveRequest: workspaceFlow.denyFileSaveRequest
    }
  });
}

import type { useAppRoomInteractionContext } from "../hooks/useAppRoomInteractionContext";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useAppRelaySync } from "../hooks/useAppRelaySync";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";
import { createRoomPanelActions } from "./roomPanelActions";

type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;

export function createAppRoomPanelActions({
  roomInteraction,
  roomRuntime,
  relaySync,
  workspaceFlow
}: {
  roomInteraction: RoomInteraction;
  roomRuntime: RoomRuntime;
  relaySync: RelaySync;
  workspaceFlow: WorkspaceFlow;
}) {
  return createRoomPanelActions({
    chat: {
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
      publishCodexQueueEvent: relaySync.publishCodexQueueEvent,
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
      openRoomBrowserNow: roomRuntime.openRoomBrowserNow
    },
    terminal: {
      copyTerminalMarkdown: workspaceFlow.copyTerminalMarkdown,
      openInteractiveTerminal: roomRuntime.openInteractiveTerminal,
      approveTerminalRequest: roomRuntime.approveTerminalRequest,
      denyTerminalRequest: roomRuntime.denyTerminalRequest,
      sendTerminalData: roomRuntime.sendTerminalData,
      restartSelectedTerminal: roomRuntime.restartSelectedTerminal,
      stopSelectedTerminal: roomRuntime.stopSelectedTerminal,
      revokeExactCommandGrants: roomRuntime.revokeExactCommandGrants
    },
    workspaceFiles: {
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

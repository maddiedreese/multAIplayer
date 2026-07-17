import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomRuntime } from "./useAppRoomRuntime";
import type { useAppRelaySync } from "./useAppRelaySync";
import type { WorkspaceFlow } from "./useAppWorkspaceFlow";
import { createRoomChatPanelActions } from "../application/chat/roomChatPanelActions";
import { createRoomHeaderActions } from "../application/rooms/roomHeaderActions";
import { createTerminalPanelActions } from "../application/terminal/terminalPanelActions";
import { createWorkspaceFilesPanelActions } from "../application/files/workspaceFilesPanelActions";

type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomRuntime = ReturnType<typeof useAppRoomRuntime>;
type RelaySync = ReturnType<typeof useAppRelaySync>;

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
  return {
    roomChatPanelActions: createRoomChatPanelActions({
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
    }),
    roomHeaderActions: createRoomHeaderActions({
      openRoomBrowserNow: roomRuntime.openRoomBrowserNow
    }),
    terminalPanelActions: createTerminalPanelActions({
      copyTerminalMarkdown: workspaceFlow.copyTerminalMarkdown,
      openInteractiveTerminal: roomRuntime.openInteractiveTerminal,
      approveTerminalRequest: roomRuntime.approveTerminalRequest,
      denyTerminalRequest: roomRuntime.denyTerminalRequest,
      sendTerminalData: roomRuntime.sendTerminalData,
      restartSelectedTerminal: roomRuntime.restartSelectedTerminal,
      stopSelectedTerminal: roomRuntime.stopSelectedTerminal,
      revokeExactCommandGrants: roomRuntime.revokeExactCommandGrants
    }),
    workspaceFilesPanelActions: createWorkspaceFilesPanelActions({
      copyProjectMarkdown: workspaceFlow.copyProjectMarkdown,
      openProjectFile: workspaceFlow.openProjectFile,
      copyDiffSummaryMarkdown: workspaceFlow.copyDiffSummaryMarkdown,
      attachSelectedFileToMessage: workspaceFlow.attachSelectedFileToMessage,
      saveSelectedFileContent: workspaceFlow.saveSelectedFileContent,
      approveFileSaveRequest: workspaceFlow.approveFileSaveRequest,
      denyFileSaveRequest: workspaceFlow.denyFileSaveRequest
    })
  };
}

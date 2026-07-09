import {
  codexModelOptions,
  codexReasoningEffortOptions,
  codexSpeedOptions
} from "@multaiplayer/protocol";
import type { AppViewModelOptions } from "./appViewModelTypes";
import type { useAppViewProps } from "./useAppViewProps";

type RoomMainColumnInput = Parameters<typeof useAppViewProps>[0]["roomMainColumn"];
type RoomMainColumnOptions = Pick<
  AppViewModelOptions,
  | "appState"
  | "localIdentity"
  | "selected"
  | "selectedRuntime"
  | "roomInteraction"
  | "roomActions"
  | "roomPanels"
  | "roomRuntime"
  | "workspaceFlow"
  | "hostHandoffActions"
>;

export function createRoomMainColumnInput({
  appState,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  roomPanels,
  roomRuntime,
  workspaceFlow,
  hostHandoffActions
}: RoomMainColumnOptions): RoomMainColumnInput {
  const { workspaceState } = appState;
  const {
    selectedRoom,
    hasSelectedRoom,
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedMessages,
    markdownSelectionMode,
    inspectorTab,
    secretWarningVisible,
    markdownCopyFallback,
    draft,
    pendingAttachments,
    roomGoal,
    toggleMarkdownSelectionMode,
    clearSelectedMessages,
    toggleMessageSelection
  } = selected;

  return {
    teamRecords: workspaceState.teams,
    selectedTeam: workspaceState.selectedTeam,
    selectedRoom,
    localUser: localIdentity.localUser,
    hostBusy: selectedRuntime.hostBusy,
    isActiveHost: roomInteraction.isActiveHost,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
    hasSelectedRoom,
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    modelOptions: codexModelOptions,
    reasoningOptions: codexReasoningEffortOptions,
    speedOptions: codexSpeedOptions,
    settingsBusy: selectedRuntime.settingsBusy,
    selectedMessages,
    markdownSelectionMode,
    inspectorTab,
    roomHeaderActions: roomPanels.roomHeaderActions,
    onSetHost: hostHandoffActions.setRoomHost,
    onRenameRoom: roomRuntime.renameRoom,
    onSelectModel: roomRuntime.setCodexModel,
    onSelectReasoningEffort: roomRuntime.setCodexReasoningEffort,
    onSelectSpeed: roomRuntime.setCodexSpeed,
    onCopyRoomMarkdown: workspaceFlow.copyRoomMarkdown,
    onCopySelectedMarkdown: workspaceFlow.copySelectedMessagesMarkdown,
    onToggleMarkdownSelection: toggleMarkdownSelectionMode,
    onClearSelectedMessages: clearSelectedMessages,
    onShareLocalPreview: roomRuntime.openLocalPreviewDialog,
    notices: roomInteraction.roomNotices,
    secretWarningVisible,
    onAcknowledgeSecretWarning: roomInteraction.acknowledgeRoomVisibilityWarning,
    markdownCopyFallback,
    copyMarkdownWithFallback: workspaceFlow.copyMarkdownWithFallback,
    setChatMessageForRoom: roomActions.setChatMessageForRoom,
    setMarkdownCopyFallbackForRoom: roomActions.setMarkdownCopyFallbackForRoom,
    messages: selectedRuntime.chatMessageRows,
    approvalVisible: selectedRuntime.approvalVisible,
    approvalSummary: selectedRuntime.codexApprovalSummaryDisplay,
    codexRunning: selectedRuntime.codexRunning,
    roomCanUseChat: selectedRuntime.roomCanUseChat,
    draft,
    replyTarget: selectedRuntime.replyTarget,
    roomGoal,
    pendingAttachmentsForCount: pendingAttachments,
    pendingAttachments: selectedRuntime.pendingAttachmentRows,
    queuedCodexTurns: selectedRuntime.queuedCodexTurnRows,
    localPreviewCards: selectedRuntime.localPreviewCards,
    pendingAttachmentSummary: selectedRuntime.pendingAttachmentSummary,
    onToggleMessageSelection: toggleMessageSelection,
    onRemovePendingAttachment: workspaceFlow.removePendingAttachment,
    onSendMessage: roomRuntime.sendMessage,
    roomChatPanelActions: roomPanels.roomChatPanelActions
  };
}

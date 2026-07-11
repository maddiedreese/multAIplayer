import React, { useCallback, useMemo, type ComponentProps } from "react";
import {
  defaultCodexSandboxLevel,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import { RoomMainColumn } from "./RoomMainColumn";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { emptyRoom, fallbackUser } from "../seedData";
import { canApproveCodexTurn } from "../lib/codexApproval";
import { formatApprovalAttachments, formatApprovalMessages } from "../lib/codexApprovalSummary";
import {
  embeddedAttachmentBytes,
  formatBytes,
  formatCodexModel,
  formatCodexReasoningEffort,
  formatCodexSandboxLevel,
  formatCodexSpeed
} from "../lib/appFormatters";
import { roomLockMessage } from "../lib/appRuntime";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../lib/codexCatalogResolver";
import { canUseRoomChat } from "../lib/chatPolicy";
import { buildLocalPreviewCards, buildPendingAttachmentRows, buildRoomChatMessageRows } from "../lib/chatDisplayRows";
import { detectCodexTurnRiskFlags, messagesSinceLastCodex } from "../lib/codexTurn";
import { buildRoomNotices } from "../lib/roomNotices";
import { isLocalUserActiveHostForRoom } from "../lib/roomHost";
import { acknowledgeRoomVisibilityWarning, hasAcknowledgedRoomVisibilityWarning } from "../lib/roomVisibilityWarning";
import type { ChatAttachment, ChatMessage, CodexRoomEvent } from "../types";
import type { createAppRoomPanelActions } from "../lib/appRoomPanelActions";
import type { useHostHandoffActions } from "../hooks/useHostHandoffActions";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";

type MainColumnProps = ComponentProps<typeof RoomMainColumn>;
type HeaderProps = MainColumnProps["headerProps"];
type ChatProps = MainColumnProps["chatProps"];

export interface RoomMainColumnCapabilities {
  header: Pick<
    HeaderProps,
    | "onSetHost"
    | "onRenameRoom"
    | "onSelectModel"
    | "onSelectReasoningEffort"
    | "onSelectSpeed"
    | "onCopyRoomMarkdown"
    | "onCopySelectedMarkdown"
    | "onShareLocalPreview"
  > & { onOpenRoomBrowser: () => void };
  chat: Pick<
    ChatProps,
    | "onCopyMessageMarkdown"
    | "onOpenAttachment"
    | "onToggleReaction"
    | "onEditMessage"
    | "onDeleteMessage"
    | "onDenyApproval"
    | "onApproveApproval"
    | "onInvokeCodex"
    | "onRemovePendingAttachment"
    | "onPauseGoal"
    | "onResumeGoal"
    | "onEditGoal"
    | "onDeleteGoal"
    | "onTickGoalElapsed"
    | "onOpenLocalPreview"
    | "onCopyLocalPreviewLink"
    | "onStopLocalPreview"
    | "onCancelQueuedCodexTurn"
    | "onSendMessage"
  >;
  retryMarkdownCopy: (title: string, markdown: string, roomId: string) => void;
}

type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;
type HostHandoffActions = ReturnType<typeof useHostHandoffActions>;
type RoomPanels = ReturnType<typeof createAppRoomPanelActions>;

export interface RoomMainColumnSources {
  roomRuntime: Pick<
    RoomRuntime,
    | "renameRoom"
    | "setCodexModel"
    | "setCodexReasoningEffort"
    | "setCodexSpeed"
    | "openLocalPreviewDialog"
    | "openRoomBrowserNow"
    | "sendMessage"
  >;
  workspaceFlow: Pick<
    WorkspaceFlow,
    "copyRoomMarkdown" | "copySelectedMessagesMarkdown" | "removePendingAttachment" | "copyMarkdownWithFallback"
  >;
  hostHandoff: Pick<HostHandoffActions, "setRoomHost">;
  chatActions: RoomPanels["roomChatPanelActions"];
}

const noMessages: NonNullable<ReturnType<typeof useAppStore.getState>["messagesByRoom"][string]> = [];
const noBrowserRequests: NonNullable<
  NonNullable<ReturnType<typeof useAppStore.getState>["browserByRoom"][string]>["requests"]
> = [];
const noPreviews: NonNullable<
  NonNullable<ReturnType<typeof useAppStore.getState>["localPreviewByRoom"][string]>["previews"]
> = [];
const noPendingAttachments: ChatAttachment[] = [];
const noSelectedMessageIds: string[] = [];
const noCodexEvents: CodexRoomEvent[] = [];

export function RoomMainColumnContainer({ sources }: { sources: RoomMainColumnSources }) {
  const capabilities = useMemo<RoomMainColumnCapabilities>(
    () => ({
      header: {
        onSetHost: sources.hostHandoff.setRoomHost,
        onRenameRoom: sources.roomRuntime.renameRoom,
        onSelectModel: sources.roomRuntime.setCodexModel,
        onSelectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
        onSelectSpeed: sources.roomRuntime.setCodexSpeed,
        onCopyRoomMarkdown: sources.workspaceFlow.copyRoomMarkdown,
        onCopySelectedMarkdown: sources.workspaceFlow.copySelectedMessagesMarkdown,
        onShareLocalPreview: sources.roomRuntime.openLocalPreviewDialog,
        onOpenRoomBrowser: sources.roomRuntime.openRoomBrowserNow
      },
      chat: {
        onCopyMessageMarkdown: sources.chatActions.onCopyMessageMarkdown,
        onOpenAttachment: sources.chatActions.onOpenAttachment,
        onToggleReaction: sources.chatActions.onToggleReaction,
        onEditMessage: sources.chatActions.onEditMessage,
        onDeleteMessage: sources.chatActions.onDeleteMessage,
        onDenyApproval: sources.chatActions.onDenyApproval,
        onApproveApproval: sources.chatActions.onApproveApproval,
        onInvokeCodex: sources.chatActions.onInvokeCodex,
        onRemovePendingAttachment: sources.workspaceFlow.removePendingAttachment,
        onPauseGoal: sources.chatActions.onPauseGoal,
        onResumeGoal: sources.chatActions.onResumeGoal,
        onEditGoal: sources.chatActions.onEditGoal,
        onDeleteGoal: sources.chatActions.onDeleteGoal,
        onTickGoalElapsed: sources.chatActions.onTickGoalElapsed,
        onOpenLocalPreview: sources.chatActions.onOpenLocalPreview,
        onCopyLocalPreviewLink: sources.chatActions.onCopyLocalPreviewLink,
        onStopLocalPreview: sources.chatActions.onStopLocalPreview,
        onCancelQueuedCodexTurn: sources.chatActions.onCancelQueuedCodexTurn,
        onSendMessage: sources.roomRuntime.sendMessage
      },
      retryMarkdownCopy: (title, markdown, roomId) => {
        void sources.workspaceFlow.copyMarkdownWithFallback(
          title,
          markdown,
          (message) => useAppStore.getState().setChatMessageForRoom(roomId, message),
          roomId
        );
      }
    }),
    [
      sources.chatActions.onApproveApproval,
      sources.chatActions.onCancelQueuedCodexTurn,
      sources.chatActions.onCopyLocalPreviewLink,
      sources.chatActions.onCopyMessageMarkdown,
      sources.chatActions.onDeleteGoal,
      sources.chatActions.onDeleteMessage,
      sources.chatActions.onDenyApproval,
      sources.chatActions.onEditGoal,
      sources.chatActions.onEditMessage,
      sources.chatActions.onInvokeCodex,
      sources.chatActions.onOpenAttachment,
      sources.chatActions.onOpenLocalPreview,
      sources.chatActions.onPauseGoal,
      sources.chatActions.onResumeGoal,
      sources.chatActions.onStopLocalPreview,
      sources.chatActions.onTickGoalElapsed,
      sources.chatActions.onToggleReaction,
      sources.workspaceFlow,
      sources.hostHandoff.setRoomHost,
      sources.roomRuntime.openLocalPreviewDialog,
      sources.roomRuntime.openRoomBrowserNow,
      sources.roomRuntime.renameRoom,
      sources.roomRuntime.sendMessage,
      sources.roomRuntime.setCodexModel,
      sources.roomRuntime.setCodexReasoningEffort,
      sources.roomRuntime.setCodexSpeed
    ]
  );
  const {
    teams,
    selectedTeam,
    selectedRoomId,
    selectedRoom,
    hasSelectedRoom,
    messages,
    chat,
    settings,
    codex,
    previews,
    fallback,
    inspectorTab,
    forgotten,
    revoked,
    codexProbe,
    currentUser,
    browserRequests
  } = useAppStore(
    useShallow((state) => {
      const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
      const roomId = selectedRoom.id;
      return {
        teams: state.teams,
        selectedTeam: state.selectedTeam,
        selectedRoomId: state.selectedRoomId,
        selectedRoom,
        hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
        messages: state.messagesByRoom[roomId] ?? noMessages,
        chat: state.roomChatByRoom[roomId],
        settings: state.roomSettingsByRoom[roomId],
        codex: state.codexRuntimeByRoom[roomId],
        previews: state.localPreviewByRoom[roomId]?.previews ?? noPreviews,
        fallback: state.filePanelByRoom[roomId]?.markdownCopyFallback ?? null,
        inspectorTab: state.historyPresenceByRoom[roomId]?.inspectorTab ?? "files",
        forgotten: state.forgottenRoomIds.has(roomId),
        revoked: state.revokedRoomIds.has(roomId) || state.revokedTeamIds.has(selectedRoom.teamId),
        codexProbe: state.codexProbe,
        currentUser: state.currentUser,
        browserRequests: state.browserByRoom[roomId]?.requests ?? noBrowserRequests
      };
    })
  );
  const roomId = selectedRoom.id;

  const localUser = {
    id: currentUser?.id ?? fallbackUser.id,
    name: currentUser?.name ?? currentUser?.login ?? fallbackUser.name
  };
  const roomLocked = forgotten || revoked || Boolean(selectedRoom.archivedAt);
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser);
  const pendingAttachments = chat?.pendingAttachments ?? noPendingAttachments;
  const selectedMessageIds = chat?.selectedMessageIds ?? noSelectedMessageIds;
  const markdownSelectionMode = chat?.markdownSelectionMode ?? false;
  const activeApproval = codex?.pendingApproval ?? null;
  const approvalMessages = messagesSinceLastCodex(activeApproval?.messages ?? messages) as ChatMessage[];
  const resolvedSettings = resolveCodexRunSettings(selectedRoom, codexProbe);
  const codexEvents = codex?.events ?? noCodexEvents;
  const queuedApprovals = codex?.queuedApprovals ?? [];
  const currentMessagesSinceLastCodex = messagesSinceLastCodex(messages).length;
  const replyTargetMessage = chat?.replyToMessageId
    ? (messages.find((message) => message.id === chat.replyToMessageId) ?? null)
    : null;

  const { onOpenRoomBrowser, ...headerCapabilities } = capabilities.header;
  const onSelectTeam = useCallback(
    (teamId: string) => useAppStore.getState().selectTeamRoom(teamId, selectedRoomId),
    [selectedRoomId]
  );
  const onSelectInspectorTab = useCallback(
    (tab: HeaderProps["activeInspectorTab"]) => {
      useAppStore.getState().setInspectorTabForRoom(roomId, tab);
      if (tab === "browser" && !useAppStore.getState().browserByRoom[roomId]?.activeUrl) {
        onOpenRoomBrowser();
      }
    },
    [onOpenRoomBrowser, roomId]
  );
  const onToggleMarkdownSelection = useCallback(
    () => useAppStore.getState().toggleMarkdownSelectionModeForRoom(roomId),
    [roomId]
  );
  const onClearSelectedMessages = useCallback(
    () => useAppStore.getState().clearSelectedMessagesForRoom(roomId),
    [roomId]
  );
  const onToggleMessageSelection = useCallback(
    (messageId: string) => useAppStore.getState().toggleSelectedMessageForRoom(roomId, messageId),
    [roomId]
  );
  const onOpenFileSelector = useCallback(
    () => useAppStore.getState().setInspectorTabForRoom(roomId, "files"),
    [roomId]
  );
  const onReplyToMessage = useCallback(
    (messageId: string) => useAppStore.getState().setReplyToMessageForRoom(roomId, messageId),
    [roomId]
  );
  const onCancelReply = useCallback(() => useAppStore.getState().setReplyToMessageForRoom(roomId, null), [roomId]);
  const onDraftChange = useCallback((draft: string) => useAppStore.getState().setDraftForRoom(roomId, draft), [roomId]);
  const onAcknowledgeSecretWarning = useCallback(() => {
    acknowledgeRoomVisibilityWarning(roomId);
    useAppStore.getState().setSecretWarningVisibleForRoom(roomId, false);
  }, [roomId]);
  const onDismissMarkdownFallback = useCallback(
    () => useAppStore.getState().setMarkdownCopyFallbackForRoom(roomId, null),
    [roomId]
  );
  const onRetryMarkdownCopy = useCallback(() => {
    if (fallback) capabilities.retryMarkdownCopy(fallback.title, fallback.markdown, roomId);
  }, [capabilities, fallback, roomId]);
  const chatMessageRows = useMemo(
    () =>
      buildRoomChatMessageRows({
        messages,
        markdownSelectionMode,
        selectedMessageIds,
        localUserId: localUser.id,
        codexEvents
      }),
    [codexEvents, localUser.id, markdownSelectionMode, messages, selectedMessageIds]
  );
  const pendingAttachmentRows = useMemo(() => buildPendingAttachmentRows(pendingAttachments), [pendingAttachments]);
  const localPreviewCards = useMemo(() => buildLocalPreviewCards(previews, localUser.id), [localUser.id, previews]);
  const headerProps: HeaderProps = {
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    selectedTeamId: selectedTeam,
    roomName: selectedRoom.name,
    hostStatus: selectedRoom.hostStatus,
    hostBusy: settings?.hostBusy ?? false,
    isActiveHost,
    roomLocked,
    hasRoom: hasSelectedRoom,
    selectedModel: resolvedSettings.model,
    modelLabel: formatCodexModel(resolvedSettings.model),
    modelOptions: catalogModelOptions(codexProbe),
    selectedReasoningEffort: resolvedSettings.reasoningEffort,
    reasoningLabel: formatCodexReasoningEffort(resolvedSettings.reasoningEffort),
    reasoningOptions: catalogReasoningOptionsForModel(codexProbe, resolvedSettings.model),
    selectedSpeed: resolvedSettings.speed,
    speedLabel: formatCodexSpeed(resolvedSettings.speed),
    speedOptions: catalogSpeedOptionsForModel(codexProbe, resolvedSettings.model),
    settingsBusy: settings?.settingsBusy ?? false,
    selectedCount: selectedMessageIds.length,
    markdownSelectionMode,
    activeInspectorTab: inspectorTab,
    onSelectTeam,
    onSelectInspectorTab,
    onToggleMarkdownSelection,
    onClearSelectedMessages,
    ...headerCapabilities
  };
  const chatProps: ChatProps = {
    messages: chatMessageRows,
    approvalVisible: codex?.approvalVisible ?? false,
    approvalSummary: {
      messages: formatApprovalMessages(approvalMessages),
      attachments: formatApprovalAttachments(approvalMessages),
      sandbox: formatCodexSandboxLevel(selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel),
      highPrivilegeLabels: highPrivilegeLabels(activeApproval?.summary, selectedRoom.codexSandboxLevel),
      riskFlags: activeApproval ? detectCodexTurnRiskFlags(approvalMessages, selectedRoom, browserRequests, null) : []
    },
    isActiveHost,
    codexRunning: codex?.running ?? false,
    canApproveCodex: hasSelectedRoom && canApproveCodexTurn(selectedRoom, localUser, roomLocked),
    canUseChat: canUseRoomChat(selectedRoom, roomLocked),
    canSendMessage:
      canUseRoomChat(selectedRoom, roomLocked) && (Boolean(chat?.draft?.trim()) || pendingAttachments.length > 0),
    roomLocked,
    lockedPlaceholder: roomLockMessage(selectedRoom, revoked),
    chatEnabled: !roomLocked,
    draft: chat?.draft ?? "",
    replyTarget: replyTargetMessage
      ? {
          author: replyTargetMessage.deletedAt ? "Original message" : replyTargetMessage.author,
          body: replyTargetMessage.deletedAt
            ? "Original message deleted"
            : replyTargetMessage.body || "Original message unavailable or deleted"
        }
      : null,
    roomGoal: codex?.goal ?? null,
    pendingAttachments: pendingAttachmentRows,
    queuedCodexTurns: queuedApprovals.map((turn) => ({
      turnId: turn.turnId,
      requestedBy: turn.requestedBy,
      requestedByUserId: turn.requestedByUserId,
      queuedAt: turn.queuedAt,
      messagesSinceLastCodex: currentMessagesSinceLastCodex,
      canCancel: !roomLocked && (turn.requestedByUserId === localUser.id || selectedRoom.hostUserId === localUser.id)
    })),
    localPreviewCards,
    pendingAttachmentSummary:
      `${pendingAttachments.length}/${maxMessageAttachments} files · ` +
      `${formatBytes(embeddedAttachmentBytes(pendingAttachments))}/${formatBytes(maxEmbeddedAttachmentBytesPerMessage)}`,
    markdownSelectionMode,
    onToggleMessageSelection,
    onOpenFileSelector,
    onReplyToMessage,
    onCancelReply,
    onDraftChange,
    ...capabilities.chat
  };

  const secretWarningVisible =
    hasSelectedRoom && (codex?.secretWarningVisible ?? !hasAcknowledgedRoomVisibilityWarning(roomId));
  return (
    <RoomMainColumn
      headerProps={headerProps}
      statusProps={{
        notices: buildRoomNotices({
          roomId,
          hostMessage: settings?.hostMessage ?? null,
          chatMessage: chat?.message ?? null
        }),
        secretWarningVisible,
        lockedMessage: roomLocked ? roomLockMessage(selectedRoom, revoked) : null,
        onAcknowledgeSecretWarning
      }}
      markdownFallbackProps={
        fallback
          ? {
              title: fallback.title,
              markdown: fallback.markdown,
              onRetryCopy: onRetryMarkdownCopy,
              onDismiss: onDismissMarkdownFallback
            }
          : null
      }
      chatProps={chatProps}
    />
  );
}

function highPrivilegeLabels(
  summary:
    | {
        attachments: unknown[];
        workspacePath: string | null;
        git: unknown | null;
        browserAccess: unknown[];
        terminals: unknown[];
      }
    | undefined,
  sandboxLevel: string | undefined
): string[] {
  if (!summary) return [];
  const labels: string[] = [];
  if ((sandboxLevel ?? defaultCodexSandboxLevel) === "danger_full_access") labels.push("full-access Codex");
  if (summary.terminals.length > 0) labels.push("terminal context");
  if (summary.workspacePath || summary.git) labels.push("workspace/Git context");
  if (summary.browserAccess.length > 0) labels.push("browser context");
  if (summary.attachments.length > 0) labels.push("attachments");
  return labels;
}

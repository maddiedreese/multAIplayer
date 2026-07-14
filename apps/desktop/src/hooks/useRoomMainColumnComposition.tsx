import React, { useCallback, useMemo, type ComponentProps } from "react";
import {
  defaultCodexSandboxLevel,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import { RoomMainColumn } from "../components/RoomMainColumn";
import { GuidedFirstTurn, type GuidedActivityKind, type GuidedFirstTurnPhase } from "../components/GuidedFirstTurn";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { loadOrCreateDeviceId } from "../lib/appRuntime";
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
import { selectRoomMainColumnView } from "../lib/containerViewSelectors";
import { buildRoomMainColumnCapabilities } from "../lib/containerCapabilities";
import {
  buildHighPrivilegeLabels,
  buildQueuedCodexTurnRows,
  buildRoomMainChatProps,
  buildRoomMainHeaderProps
} from "../lib/containerPropBuilders";
import { isLocalUserActiveHostForRoom } from "../lib/roomHost";
import { acknowledgeRoomVisibilityWarning, hasAcknowledgedRoomVisibilityWarning } from "../lib/roomVisibilityWarning";
import type { ChatAttachment, ChatMessage, CodexActivity, CodexRoomEvent } from "../types";
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

const noPendingAttachments: ChatAttachment[] = [];
const noSelectedMessageIds: string[] = [];
const noCodexEvents: CodexRoomEvent[] = [];

export function useRoomMainColumnComposition({ sources }: { sources: RoomMainColumnSources }) {
  const capabilities = useMemo(() => buildRoomMainColumnCapabilities(sources), [sources]);
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
  } = useAppStore(useShallow(selectRoomMainColumnView));
  const roomId = selectedRoom.id;
  const onboarding = useAppStore((state) => state.onboarding);

  const localDeviceId = React.useMemo(() => loadOrCreateDeviceId(), []);
  const localUser = {
    id: currentUser?.id ?? `local:${localDeviceId}`,
    name: currentUser?.name ?? currentUser?.login ?? "Local user"
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
  const headerProps = buildRoomMainHeaderProps({
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
  });
  const guidedVisible =
    onboarding.presentation === "open" &&
    onboarding.surface === "guided_turn" &&
    onboarding.markers.membership?.roomId === roomId;
  const guidedPhase: GuidedFirstTurnPhase = onboarding.markers.firstTurnCompleted
    ? "complete"
    : codex?.approvalVisible
      ? "approval"
      : codex?.running
        ? "activity"
        : isActiveHost
          ? "composer"
          : "host";
  const guidedActivityKinds = Array.from(
    new Set((codex?.activities ?? []).map((activity) => guidedActivityKind(activity.kind)).filter(Boolean))
  ) as GuidedActivityKind[];
  const guidedFirstTurn = guidedVisible ? (
    <GuidedFirstTurn
      phase={guidedPhase}
      isActiveHost={isActiveHost}
      activityKinds={guidedActivityKinds}
      onUseStarterPrompt={onDraftChange}
      onReviewApproval={() => {
        const target = document.querySelector<HTMLElement>('[data-onboarding-anchor="approval-card"]');
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "center"
        });
      }}
      onDismiss={() => useAppStore.getState().applyOnboardingEvent({ type: "dismiss_assistant" })}
    />
  ) : null;
  const chatProps = {
    ...buildRoomMainChatProps({
      messages: chatMessageRows,
      codexActivities: codex?.activities ?? [],
      approvalVisible: codex?.approvalVisible ?? false,
      approvalSummary: {
        messages: formatApprovalMessages(approvalMessages),
        attachments: formatApprovalAttachments(approvalMessages),
        sandbox: formatCodexSandboxLevel(selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel),
        highPrivilegeLabels: buildHighPrivilegeLabels(activeApproval?.summary, selectedRoom.codexSandboxLevel),
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
      queuedCodexTurns: buildQueuedCodexTurnRows(
        queuedApprovals,
        currentMessagesSinceLastCodex,
        roomLocked,
        localUser.id,
        selectedRoom.hostUserId
      ),
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
    }),
    guidedFirstTurn
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

function guidedActivityKind(kind: CodexActivity["kind"]): GuidedActivityKind | null {
  if (kind === "reasoning") return "thinking";
  if (kind === "command") return "commands";
  if (kind === "file_change") return "edits";
  if (kind === "agent") return "subagents";
  if (kind === "tool" || kind === "web_search" || kind === "image_generation" || kind === "hook") return "tools";
  return null;
}

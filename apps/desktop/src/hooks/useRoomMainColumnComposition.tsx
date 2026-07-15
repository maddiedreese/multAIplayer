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
import { loadOrCreateDeviceId } from "../application/runtime/appRuntime";
import { canApproveCodexTurn } from "../lib/codex/codexApproval";
import { formatApprovalAttachments, formatApprovalMessages } from "../presentation/codex/codexApprovalSummary";
import {
  embeddedAttachmentBytes,
  formatBytes,
  formatCodexModel,
  formatCodexReasoningEffort,
  formatCodexSandboxLevel,
  formatCodexSpeed
} from "../lib/formatting/appFormatters";
import { roomLockMessage } from "../application/runtime/appRuntime";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../lib/codex/codexCatalogResolver";
import { canUseRoomChat } from "../lib/chat/chatPolicy";
import {
  buildLocalPreviewCards,
  buildPendingAttachmentRows,
  buildRoomChatMessageRows
} from "../presentation/chat/chatDisplayRows";
import { detectCodexTurnRiskFlags } from "../lib/codex/codexTurn";
import { buildRoomNotices } from "./roomNotices";
import { selectRoomMainColumnView } from "../application/views/containerViewSelectors";
import { buildRoomMainColumnCapabilities } from "./containerCapabilities";
import {
  buildHighPrivilegeLabels,
  buildQueuedCodexTurnRows,
  buildRoomMainChatProps,
  buildRoomMainHeaderProps
} from "../presentation/containers/containerPropBuilders";
import { isLocalUserActiveHostForRoom } from "../lib/access/roomHost";
import {
  acknowledgeRoomVisibilityWarning,
  hasAcknowledgedRoomVisibilityWarning
} from "../lib/history/roomVisibilityWarning";
import type { createAppRoomPanelActions } from "./appRoomPanelActions";
import type { useHostHandoffActions } from "./useHostHandoffActions";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";
import {
  deriveMainColumnValues,
  guidedActivityKind,
  mainColumnLocalUser,
  replyTargetDisplay
} from "./roomMainColumnCompositionValues";

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
  const localUser = mainColumnLocalUser(currentUser, localDeviceId);
  const roomLocked = forgotten || revoked || Boolean(selectedRoom.archivedAt);
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser);
  const {
    pendingAttachments,
    selectedMessageIds,
    markdownSelectionMode,
    activeApproval,
    approvalMessages,
    codexEvents,
    queuedApprovals,
    currentMessagesSinceLastCodex,
    replyTargetMessage
  } = deriveMainColumnValues(chat, codex, messages);
  const resolvedSettings = resolveCodexRunSettings(selectedRoom, codexProbe);

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
  function composeHeaderProps() {
    return buildRoomMainHeaderProps({
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
  }
  const headerProps = composeHeaderProps();

  function composeGuidedFirstTurn() {
    const guidedVisible =
      onboarding.presentation === "open" &&
      onboarding.surface === "guided_turn" &&
      onboarding.markers.membership?.roomId === roomId;
    if (!guidedVisible) return null;
    const phase: GuidedFirstTurnPhase = onboarding.markers.firstTurnCompleted
      ? "complete"
      : codex?.approvalVisible
        ? "approval"
        : codex?.running
          ? "activity"
          : isActiveHost
            ? "composer"
            : "host";
    const activityKinds = Array.from(
      new Set((codex?.activities ?? []).map((activity) => guidedActivityKind(activity.kind)).filter(Boolean))
    ) as GuidedActivityKind[];
    return (
      <GuidedFirstTurn
        phase={phase}
        isActiveHost={isActiveHost}
        activityKinds={activityKinds}
        onUseStarterPrompt={onDraftChange}
        onReviewApproval={focusApprovalCard}
        onDismiss={() => useAppStore.getState().applyOnboardingEvent({ type: "dismiss_assistant" })}
      />
    );
  }
  const guidedFirstTurn = composeGuidedFirstTurn();

  function composeChatProps() {
    const canUseChat = canUseRoomChat(selectedRoom, roomLocked);
    return {
      ...buildRoomMainChatProps({
        messages: chatMessageRows,
        codexActivities: codex?.activities ?? [],
        approvalVisible: codex?.approvalVisible ?? false,
        approvalSummary: composeApprovalSummary(),
        isActiveHost,
        codexRunning: codex?.running ?? false,
        canApproveCodex: hasSelectedRoom && canApproveCodexTurn(selectedRoom, localUser, roomLocked),
        canUseChat,
        canSendMessage: canUseChat && (Boolean(chat?.draft?.trim()) || pendingAttachments.length > 0),
        roomLocked,
        lockedPlaceholder: roomLockMessage(selectedRoom, revoked),
        chatEnabled: !roomLocked,
        draft: chat?.draft ?? "",
        replyTarget: composeReplyTarget(),
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
  }

  function composeApprovalSummary() {
    return {
      messages: formatApprovalMessages(approvalMessages),
      attachments: formatApprovalAttachments(approvalMessages),
      sandbox: formatCodexSandboxLevel(selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel),
      highPrivilegeLabels: buildHighPrivilegeLabels(activeApproval?.summary, selectedRoom.codexSandboxLevel),
      riskFlags: activeApproval ? detectCodexTurnRiskFlags(approvalMessages, selectedRoom, browserRequests, null) : []
    };
  }

  function composeReplyTarget() {
    return replyTargetDisplay(replyTargetMessage);
  }
  const chatProps = composeChatProps();

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

function focusApprovalCard() {
  const target = document.querySelector<HTMLElement>('[data-onboarding-anchor="approval-card"]');
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center"
  });
}

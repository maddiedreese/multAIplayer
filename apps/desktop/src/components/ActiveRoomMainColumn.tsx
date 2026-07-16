import React, { useMemo } from "react";
import {
  defaultCodexSandboxLevel,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import { RoomMainColumn } from "./RoomMainColumn";
import type { RoomChatPanel } from "./RoomChatPanel";
import type { RoomHeader } from "./RoomHeader";
import { GuidedFirstTurn, type GuidedActivityKind, type GuidedFirstTurnPhase } from "./GuidedFirstTurn";
import { useAppStore, type AppStoreState } from "../store/appStore";
import { loadOrCreateDeviceId } from "../application/runtime/appRuntime";
import { canApproveCodexTurn } from "../lib/codex/codexApproval";
import {
  buildHighPrivilegeLabels,
  formatApprovalAttachments,
  formatApprovalMessages
} from "../presentation/codex/codexApprovalSummary";
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
import { buildRoomNotices } from "../hooks/roomNotices";
import { isLocalUserActiveHostForRoom } from "../lib/access/roomHost";
import { hasAcknowledgedRoomVisibilityWarning } from "../lib/history/roomVisibilityWarning";
import {
  deriveMainColumnValues,
  guidedActivityKind,
  mainColumnLocalUser,
  replyTargetDisplay
} from "../hooks/activeRoomMainColumnValues";
import { useRoomMainColumnInteractions } from "../hooks/useRoomMainColumnInteractions";
import type { ClientRoomRecord } from "@multaiplayer/protocol";

const noMessages: NonNullable<AppStoreState["messagesByRoom"][string]> = [];
const noPreviews: NonNullable<NonNullable<AppStoreState["localPreviewByRoom"][string]>["previews"]> = [];

type HeaderProps = React.ComponentProps<typeof RoomHeader>;
type ChatProps = React.ComponentProps<typeof RoomChatPanel>;

type RoomChatActions = Pick<
  ChatProps,
  | "onCopyMessageMarkdown"
  | "onOpenAttachment"
  | "onToggleReaction"
  | "onEditMessage"
  | "onDeleteMessage"
  | "onDenyApproval"
  | "onApproveApproval"
  | "onInvokeCodex"
  | "onPauseGoal"
  | "onResumeGoal"
  | "onEditGoal"
  | "onDeleteGoal"
  | "onTickGoalElapsed"
  | "onOpenLocalPreview"
  | "onCopyLocalPreviewLink"
  | "onStopLocalPreview"
  | "onOpenFileSelector"
  | "onReplyToMessage"
  | "onCancelReply"
  | "onCancelQueuedCodexTurn"
  | "onDraftChange"
>;

/** UI capabilities required to render and operate the selected-room main column. */
export interface RoomMainColumnSources {
  roomRuntime: {
    renameRoom: HeaderProps["onRenameRoom"];
    setCodexModel: HeaderProps["onSelectModel"];
    setCodexReasoningEffort: HeaderProps["onSelectReasoningEffort"];
    setCodexSpeed: HeaderProps["onSelectSpeed"];
    openLocalPreviewDialog: HeaderProps["onShareLocalPreview"];
    openRoomBrowserNow: () => void;
    sendMessage: ChatProps["onSendMessage"];
  };
  workspaceFlow: {
    copyRoomMarkdown: HeaderProps["onCopyRoomMarkdown"];
    copySelectedMessagesMarkdown: HeaderProps["onCopySelectedMarkdown"];
    removePendingAttachment: ChatProps["onRemovePendingAttachment"];
    copyMarkdownWithFallback: (
      title: string,
      markdown: string,
      setMessage: (message: string) => void,
      roomId: string
    ) => Promise<void>;
  };
  hostHandoff: { setRoomHost: HeaderProps["onSetHost"] };
  chatActions: RoomChatActions;
}

export function ActiveRoomMainColumn({
  sources,
  selectedRoom
}: {
  sources: RoomMainColumnSources;
  selectedRoom: ClientRoomRecord;
}) {
  const roomId = selectedRoom.id;
  const teams = useAppStore((state) => state.teams);
  const selectedTeam = useAppStore((state) => state.selectedTeam);
  const selectedRoomId = useAppStore((state) => state.selectedRoomId);
  const hasSelectedRoom = selectedRoomId != null;
  const messages = useAppStore((state) => state.messagesByRoom[roomId] ?? noMessages);
  const chat = useAppStore((state) => state.roomChatByRoom[roomId]);
  const settings = useAppStore((state) => state.roomSettingsByRoom[roomId]);
  const codex = useAppStore((state) => state.codexRuntimeByRoom[roomId]);
  const previews = useAppStore((state) => state.localPreviewByRoom[roomId]?.previews ?? noPreviews);
  const fallback = useAppStore((state) => state.filePanelByRoom[roomId]?.markdownCopyFallback ?? null);
  const inspectorTab = useAppStore((state) => state.historyPresenceByRoom[roomId]?.inspectorTab ?? "files");
  const forgotten = useAppStore((state) => state.forgottenRoomIds.has(roomId));
  const revoked = useAppStore(
    (state) => state.revokedRoomIds.has(roomId) || state.revokedTeamIds.has(selectedRoom.teamId)
  );
  const codexProbe = useAppStore((state) => state.codexProbe);
  const currentUser = useAppStore((state) => state.currentUser);
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

  const onOpenRoomBrowser = sources.roomRuntime.openRoomBrowserNow;
  const {
    onSelectTeam,
    onSelectInspectorTab,
    onToggleMarkdownSelection,
    onClearSelectedMessages,
    onToggleMessageSelection,
    onDraftChange,
    onAcknowledgeSecretWarning,
    onDismissMarkdownFallback,
    onRetryMarkdownCopy
  } = useRoomMainColumnInteractions({
    roomId,
    selectedRoomId,
    fallback,
    onOpenRoomBrowser,
    retryMarkdownCopy: (title, markdown, retryRoomId) => {
      void sources.workspaceFlow.copyMarkdownWithFallback(
        title,
        markdown,
        (message) => useAppStore.getState().setChatMessageForRoom(retryRoomId, message),
        retryRoomId
      );
    }
  });
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
    return {
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
      onSetHost: sources.hostHandoff.setRoomHost,
      onRenameRoom: sources.roomRuntime.renameRoom,
      onSelectModel: sources.roomRuntime.setCodexModel,
      onSelectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
      onSelectSpeed: sources.roomRuntime.setCodexSpeed,
      onCopyRoomMarkdown: sources.workspaceFlow.copyRoomMarkdown,
      onCopySelectedMarkdown: sources.workspaceFlow.copySelectedMessagesMarkdown,
      onShareLocalPreview: sources.roomRuntime.openLocalPreviewDialog
    };
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
      queuedCodexTurns: queuedCodexTurnRows(
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
      ...sources.chatActions,
      onRemovePendingAttachment: sources.workspaceFlow.removePendingAttachment,
      onSendMessage: sources.roomRuntime.sendMessage,
      guidedFirstTurn
    };
  }

  function composeApprovalSummary() {
    return {
      messages: formatApprovalMessages(approvalMessages),
      attachments: formatApprovalAttachments(approvalMessages),
      sandbox: formatCodexSandboxLevel(selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel),
      highPrivilegeLabels: buildHighPrivilegeLabels(activeApproval?.summary, selectedRoom.codexSandboxLevel),
      riskFlags: activeApproval ? detectCodexTurnRiskFlags(approvalMessages, null) : []
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

function queuedCodexTurnRows<
  T extends { turnId: string; requestedBy: string; requestedByUserId: string; queuedAt: string }
>(turns: T[], messagesSinceLastCodex: number, roomLocked: boolean, localUserId: string, hostUserId?: string) {
  return turns.map((turn) => ({
    turnId: turn.turnId,
    requestedBy: turn.requestedBy,
    requestedByUserId: turn.requestedByUserId,
    queuedAt: turn.queuedAt,
    messagesSinceLastCodex,
    canCancel: !roomLocked && (turn.requestedByUserId === localUserId || hostUserId === localUserId)
  }));
}

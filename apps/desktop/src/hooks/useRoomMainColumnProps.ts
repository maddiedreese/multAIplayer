import type { ComponentProps } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canApproveCodexTurn } from "../lib/codexApproval";
import { roomLockMessage } from "../lib/appRuntime";
import { formatCodexModel } from "../lib/appFormatters";
import type { LocalHostUser } from "../lib/roomHost";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import { RoomMainColumn } from "../components/RoomMainColumn";

type RoomMainColumnProps = ComponentProps<typeof RoomMainColumn>;
type HeaderProps = RoomMainColumnProps["headerProps"];
type StatusProps = RoomMainColumnProps["statusProps"];
type MarkdownFallbackProps = RoomMainColumnProps["markdownFallbackProps"];
type ChatProps = RoomMainColumnProps["chatProps"];

interface MarkdownCopyFallback {
  title: string;
  markdown: string;
}

interface UseRoomMainColumnPropsOptions {
  teams: HeaderProps["teams"];
  selectedTeam: string;
  selectedRoom: RoomRecord;
  localUser: LocalHostUser;
  hostBusy: boolean;
  isActiveHost: boolean;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  hasSelectedRoom: boolean;
  selectedCodexModel: string;
  modelOptions: HeaderProps["modelOptions"];
  settingsBusy: boolean;
  selectedMessageCount: number;
  markdownSelectionMode: boolean;
  inspectorTab: InspectorTab;
  roomHeaderActions: Pick<HeaderProps, "onSelectTeam" | "onSelectInspectorTab">;
  onSetHost: HeaderProps["onSetHost"];
  onRenameRoom: HeaderProps["onRenameRoom"];
  onSelectModel: HeaderProps["onSelectModel"];
  onCopyRoomMarkdown: HeaderProps["onCopyRoomMarkdown"];
  onCopySelectedMarkdown: HeaderProps["onCopySelectedMarkdown"];
  onToggleMarkdownSelection: HeaderProps["onToggleMarkdownSelection"];
  onClearSelectedMessages: HeaderProps["onClearSelectedMessages"];
  onShareLocalPreview: HeaderProps["onShareLocalPreview"];
  notices: StatusProps["notices"];
  secretWarningVisible: boolean;
  onAcknowledgeSecretWarning: StatusProps["onAcknowledgeSecretWarning"];
  markdownCopyFallback: MarkdownCopyFallback | null;
  onRetryMarkdownCopy: (title: string, markdown: string) => void;
  onDismissMarkdownFallback: () => void;
  messages: ChatProps["messages"];
  approvalVisible: boolean;
  approvalSummary: ChatProps["approvalSummary"];
  codexRunning: boolean;
  roomCanUseChat: boolean;
  draft: string;
  pendingAttachmentCount: number;
  pendingAttachments: ChatProps["pendingAttachments"];
  localPreviewCards: ChatProps["localPreviewCards"];
  pendingAttachmentSummary: string;
  onToggleMessageSelection: ChatProps["onToggleMessageSelection"];
  onRemovePendingAttachment: ChatProps["onRemovePendingAttachment"];
  onSendMessage: ChatProps["onSendMessage"];
  roomChatPanelActions: Omit<
    ChatProps,
    | "messages"
    | "approvalVisible"
    | "approvalSummary"
    | "isActiveHost"
    | "codexRunning"
    | "canApproveCodex"
    | "canUseChat"
    | "canSendMessage"
    | "roomLocked"
    | "lockedPlaceholder"
    | "chatEnabled"
    | "draft"
    | "pendingAttachments"
    | "localPreviewCards"
    | "pendingAttachmentSummary"
    | "markdownSelectionMode"
    | "onToggleMessageSelection"
    | "onRemovePendingAttachment"
    | "onSendMessage"
  >;
}

export function useRoomMainColumnProps({
  teams,
  selectedTeam,
  selectedRoom,
  localUser,
  hostBusy,
  isActiveHost,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  hasSelectedRoom,
  selectedCodexModel,
  modelOptions,
  settingsBusy,
  selectedMessageCount,
  markdownSelectionMode,
  inspectorTab,
  roomHeaderActions,
  onSetHost,
  onRenameRoom,
  onSelectModel,
  onCopyRoomMarkdown,
  onCopySelectedMarkdown,
  onToggleMarkdownSelection,
  onClearSelectedMessages,
  onShareLocalPreview,
  notices,
  secretWarningVisible,
  onAcknowledgeSecretWarning,
  markdownCopyFallback,
  onRetryMarkdownCopy,
  onDismissMarkdownFallback,
  messages,
  approvalVisible,
  approvalSummary,
  codexRunning,
  roomCanUseChat,
  draft,
  pendingAttachmentCount,
  pendingAttachments,
  localPreviewCards,
  pendingAttachmentSummary,
  onToggleMessageSelection,
  onRemovePendingAttachment,
  onSendMessage,
  roomChatPanelActions
}: UseRoomMainColumnPropsOptions): RoomMainColumnProps {
  return {
    headerProps: {
      teams,
      selectedTeamId: selectedTeam,
      roomName: selectedRoom.name,
      hostStatus: selectedRoom.hostStatus,
      hostBusy,
      isActiveHost,
      roomLocked: isSelectedRoomLocked,
      hasRoom: hasSelectedRoom,
      selectedModel: selectedCodexModel,
      modelLabel: formatCodexModel(selectedCodexModel),
      modelOptions,
      settingsBusy,
      selectedCount: selectedMessageCount,
      markdownSelectionMode,
      activeInspectorTab: inspectorTab,
      onSetHost,
      onRenameRoom,
      onSelectModel,
      onCopyRoomMarkdown,
      onCopySelectedMarkdown,
      onToggleMarkdownSelection,
      onClearSelectedMessages,
      onShareLocalPreview,
      ...roomHeaderActions
    },
    statusProps: {
      notices,
      secretWarningVisible,
      lockedMessage: isSelectedRoomLocked ? roomLockMessage(selectedRoom, isSelectedRoomRevoked) : null,
      onAcknowledgeSecretWarning
    },
    markdownFallbackProps: markdownCopyFallback ? {
      title: markdownCopyFallback.title,
      markdown: markdownCopyFallback.markdown,
      onRetryCopy: () => onRetryMarkdownCopy(markdownCopyFallback.title, markdownCopyFallback.markdown),
      onDismiss: onDismissMarkdownFallback
    } : null,
    chatProps: {
      messages,
      approvalVisible,
      approvalSummary,
      isActiveHost,
      codexRunning,
      canApproveCodex: hasSelectedRoom && canApproveCodexTurn(selectedRoom, localUser, isSelectedRoomLocked),
      canUseChat: roomCanUseChat,
      canSendMessage: roomCanUseChat && (Boolean(draft.trim()) || pendingAttachmentCount > 0),
      roomLocked: isSelectedRoomLocked,
      lockedPlaceholder: roomLockMessage(selectedRoom, isSelectedRoomRevoked),
      chatEnabled: selectedRoom.mode.chat,
      draft,
      pendingAttachments,
      localPreviewCards,
      pendingAttachmentSummary,
      markdownSelectionMode,
      onToggleMessageSelection,
      onRemovePendingAttachment,
      onSendMessage,
      ...roomChatPanelActions
    }
  };
}

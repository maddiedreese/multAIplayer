import type { RoomRecord } from "@multaiplayer/protocol";
import { defaultCodexModel } from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../lib/authClient";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  ProjectFileEntry
} from "../lib/localBackend";
import { resolveFilePreviewTab, type FilePreviewTab } from "../lib/filePreview";
import { resolveGitWorkflowDraft, type GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import { embeddedAttachmentBytes } from "../lib/appFormatters";
import type {
  TerminalUiByRoom,
  TerminalRoomUiState
} from "../store/slices/terminalSlice";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatMessage,
  InviteJoinRequest,
  MarkdownCopyFallback,
  RoomGoal,
  TerminalCommandRequest
} from "../types";

interface UseSelectedRoomValuesOptions {
  selectedRoom: RoomRecord;
  selectedRoomId: string;
  selectedTeam: string;
  selectedMessageIds: string[];
  markdownSelectionMode: boolean;
  customCodexModelsByRoom: Record<string, string>;
  projectPathDraftsByRoom: Record<string, string>;
  messagesByRoom: Record<string, ChatMessage[]>;
  draftsByRoom: Record<string, string>;
  pendingAttachmentsByRoom: Record<string, ChatAttachment[]>;
  roomGoalsByRoom: Record<string, RoomGoal>;
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
  browserUrlsByRoom: Record<string, string>;
  browserReasonsByRoom: Record<string, string>;
  activeBrowserUrlsByRoom: Record<string, string | null>;
  gitStatusByRoom: Record<string, GitStatusSummary | null>;
  gitWorkflowDraftsByRoom: Record<string, Partial<GitWorkflowDraft>>;
  gitWorkflowBusyByRoom: Record<string, boolean>;
  gitWorkflowMessagesByRoom: Record<string, string | null>;
  actionRunsByRoom: Record<string, GitHubActionRun[]>;
  actionsBusyByRoom: Record<string, boolean>;
  actionsLastCheckedByRoom: Record<string, string | null>;
  actionsMessagesByRoom: Record<string, string | null>;
  terminalLinesByRoom: Record<string, string[]>;
  terminalBusyByRoom: Record<string, boolean>;
  selectedTerminalIdsByRoom: Record<string, string | null>;
  terminalUiByRoom: TerminalUiByRoom;
  fileQueriesByRoom: Record<string, string>;
  projectFilesByRoom: Record<string, ProjectFileEntry[]>;
  selectedFilesByRoom: Record<string, ProjectFileContent | null>;
  selectedDiffsByRoom: Record<string, GitDiffResult | null>;
  filePreviewTabsByRoom: Record<string, FilePreviewTab>;
  fileBusyByRoom: Record<string, boolean>;
  fileMessagesByRoom: Record<string, string | null>;
  inviteLinksByRoom: Record<string, string>;
  inviteApprovalGatesByRoom: Record<string, boolean>;
  inviteMessagesByRoom: Record<string, string | null>;
  hostMessagesByRoom: Record<string, string | null>;
  chatMessagesByRoom: Record<string, string | null>;
  settingsMessagesByRoom: Record<string, string | null>;
  historyMessagesByRoom: Record<string, string | null>;
  teamHistoryMessagesByTeam: Record<string, string | null>;
  markdownCopyFallbacksByRoom: Record<string, MarkdownCopyFallback | null>;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}

export function useSelectedRoomValues({
  selectedRoom,
  selectedRoomId,
  selectedTeam,
  selectedMessageIds,
  markdownSelectionMode,
  customCodexModelsByRoom,
  projectPathDraftsByRoom,
  messagesByRoom,
  draftsByRoom,
  pendingAttachmentsByRoom,
  roomGoalsByRoom,
  browserRequestsByRoom,
  browserUrlsByRoom,
  browserReasonsByRoom,
  activeBrowserUrlsByRoom,
  gitStatusByRoom,
  gitWorkflowDraftsByRoom,
  gitWorkflowBusyByRoom,
  gitWorkflowMessagesByRoom,
  actionRunsByRoom,
  actionsBusyByRoom,
  actionsLastCheckedByRoom,
  actionsMessagesByRoom,
  terminalLinesByRoom,
  terminalBusyByRoom,
  selectedTerminalIdsByRoom,
  terminalUiByRoom,
  fileQueriesByRoom,
  projectFilesByRoom,
  selectedFilesByRoom,
  selectedDiffsByRoom,
  filePreviewTabsByRoom,
  fileBusyByRoom,
  fileMessagesByRoom,
  inviteLinksByRoom,
  inviteApprovalGatesByRoom,
  inviteMessagesByRoom,
  hostMessagesByRoom,
  chatMessagesByRoom,
  settingsMessagesByRoom,
  historyMessagesByRoom,
  teamHistoryMessagesByTeam,
  markdownCopyFallbacksByRoom,
  defaultBrowserUrl,
  defaultBrowserReason
}: UseSelectedRoomValuesOptions) {
  const roomId = selectedRoom.id ?? selectedRoomId;
  const selectedCodexModel = selectedRoom.codexModel ?? defaultCodexModel;
  const messages = messagesByRoom[roomId] ?? [];
  const selectedDiff = selectedDiffsByRoom[roomId] ?? null;
  const historyMessage = historyMessagesByRoom[roomId] ?? null;
  const teamHistoryMessage = teamHistoryMessagesByTeam[selectedTeam || "__no-team"] ?? null;
  const terminalUi: TerminalRoomUiState = terminalUiByRoom[roomId] ?? {};

  return {
    selectedCodexModel,
    customCodexModel: customCodexModelsByRoom[roomId] ?? selectedCodexModel,
    projectPathDraft: projectPathDraftsByRoom[roomId] ?? selectedRoom.projectPath,
    messages,
    draft: draftsByRoom[roomId] ?? "",
    selectedMessages: markdownSelectionMode
      ? messages.filter((message) => selectedMessageIds.includes(message.id))
      : [],
    pendingAttachments: pendingAttachmentsByRoom[roomId] ?? [],
    roomGoal: roomGoalsByRoom[roomId] ?? null,
    pendingAttachmentBytes: embeddedAttachmentBytes(pendingAttachmentsByRoom[roomId] ?? []),
    browserRequests: browserRequestsByRoom[roomId] ?? [],
    browserUrl: browserUrlsByRoom[roomId] ?? defaultBrowserUrl,
    browserReason: browserReasonsByRoom[roomId] ?? defaultBrowserReason,
    activeBrowserUrl: activeBrowserUrlsByRoom[roomId] ?? null,
    gitStatus: gitStatusByRoom[roomId] ?? null,
    gitWorkflowDraft: resolveGitWorkflowDraft(gitWorkflowDraftsByRoom, roomId),
    gitWorkflowBusy: gitWorkflowBusyByRoom[roomId] ?? false,
    gitWorkflowMessage: gitWorkflowMessagesByRoom[roomId] ?? null,
    actionRuns: actionRunsByRoom[roomId] ?? [],
    actionsBusy: actionsBusyByRoom[roomId] ?? false,
    actionsLastChecked: actionsLastCheckedByRoom[roomId] ?? null,
    actionsMessage: actionsMessagesByRoom[roomId] ?? null,
    terminalLines: terminalLinesByRoom[roomId] ?? [],
    terminalBusy: terminalBusyByRoom[roomId] ?? false,
    selectedTerminalId: selectedTerminalIdsByRoom[roomId] ?? null,
    terminalName: terminalUi.name ?? "dev-server",
    terminalCommand: terminalUi.command ?? "npm run dev:desktop",
    terminalInput: terminalUi.input ?? "",
    terminalError: terminalUi.error ?? null,
    fileQuery: fileQueriesByRoom[roomId] ?? "",
    projectFiles: projectFilesByRoom[roomId] ?? [],
    selectedFile: selectedFilesByRoom[roomId] ?? null,
    selectedDiff,
    filePreviewTab: resolveFilePreviewTab(
      filePreviewTabsByRoom[roomId] ?? "file",
      Boolean(selectedDiff?.diff.trim())
    ),
    fileBusy: fileBusyByRoom[roomId] ?? false,
    fileMessage: fileMessagesByRoom[roomId] ?? null,
    inviteLink: inviteLinksByRoom[roomId] ?? "",
    inviteApprovalGate: inviteApprovalGatesByRoom[roomId] ?? false,
    inviteMessage: inviteMessagesByRoom[roomId] ?? null,
    hostMessage: hostMessagesByRoom[roomId] ?? null,
    chatMessage: chatMessagesByRoom[roomId] ?? null,
    settingsMessage: settingsMessagesByRoom[roomId] ?? null,
    historyMessage,
    teamHistoryMessage,
    visibleHistoryMessage: historyMessage ?? teamHistoryMessage,
    markdownCopyFallback: markdownCopyFallbacksByRoom[roomId] ?? null
  };
}

import type { RoomRecord } from "@multaiplayer/protocol";
import { defaultCodexModel, defaultCodexReasoningEffort, defaultCodexSandboxLevel, defaultCodexSpeed } from "@multaiplayer/protocol";
import { resolveFilePreviewTab } from "../lib/filePreview";
import { resolveGitWorkflowDraft } from "../lib/gitWorkflowDraft";
import { embeddedAttachmentBytes } from "../lib/appFormatters";
import type { BrowserByRoom } from "../store/slices/browserSlice";
import type { CodexRuntimeByRoom } from "../store/slices/codexHostHandoffSlice";
import type { FilePanelByRoom } from "../store/slices/filePanelSlice";
import type { GitWorkflowRuntimeByRoom } from "../store/slices/gitWorkflowSlice";
import type { InviteByRoom } from "../store/slices/inviteSlice";
import type { RoomChatByRoom } from "../store/slices/roomChatSlice";
import type { RoomSettingsByRoom } from "../store/slices/roomSettingsSlice";
import type { TerminalRuntimeByRoom, TerminalRoomUiState } from "../store/slices/terminalSlice";
import type {
  ChatAttachment,
  ChatMessage,
  MarkdownCopyFallback
} from "../types";

interface UseSelectedRoomValuesOptions {
  selectedRoom: RoomRecord;
  selectedRoomId: string;
  selectedTeam: string;
  selectedMessageIds: string[];
  markdownSelectionMode: boolean;
  roomSettingsByRoom: RoomSettingsByRoom;
  messagesByRoom: Record<string, ChatMessage[]>;
  roomChatByRoom: RoomChatByRoom;
  codexRuntimeByRoom: CodexRuntimeByRoom;
  browserByRoom: BrowserByRoom;
  gitWorkflowRuntimeByRoom: GitWorkflowRuntimeByRoom;
  terminalRuntimeByRoom: TerminalRuntimeByRoom;
  filePanelByRoom: FilePanelByRoom;
  inviteByRoom: InviteByRoom;
  historyMessagesByRoom: Record<string, string | null>;
  teamHistoryMessagesByTeam: Record<string, string | null>;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}

export function useSelectedRoomValues({
  selectedRoom,
  selectedRoomId,
  selectedTeam,
  selectedMessageIds,
  markdownSelectionMode,
  roomSettingsByRoom,
  messagesByRoom,
  roomChatByRoom,
  codexRuntimeByRoom,
  browserByRoom,
  gitWorkflowRuntimeByRoom,
  terminalRuntimeByRoom,
  filePanelByRoom,
  inviteByRoom,
  historyMessagesByRoom,
  teamHistoryMessagesByTeam,
  defaultBrowserUrl,
  defaultBrowserReason
}: UseSelectedRoomValuesOptions) {
  const roomId = selectedRoom.id ?? selectedRoomId;
  const selectedCodexModel = selectedRoom.codexModel ?? defaultCodexModel;
  const selectedCodexReasoningEffort = selectedRoom.codexReasoningEffort ?? defaultCodexReasoningEffort;
  const selectedCodexSpeed = selectedRoom.codexSpeed ?? defaultCodexSpeed;
  const selectedCodexSandboxLevel = selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel;
  const messages = messagesByRoom[roomId] ?? [];
  const roomSettings = roomSettingsByRoom[roomId] ?? {};
  const roomChat = roomChatByRoom[roomId] ?? {};
  const codexRuntime = codexRuntimeByRoom[roomId] ?? {};
  const browser = browserByRoom[roomId] ?? {};
  const gitRuntime = gitWorkflowRuntimeByRoom[roomId] ?? {};
  const gitWorkflow = gitRuntime.workflow ?? {};
  const githubActions = gitRuntime.actions ?? {};
  const terminalRuntime = terminalRuntimeByRoom[roomId] ?? {};
  const filePanel = filePanelByRoom[roomId] ?? {};
  const invite = inviteByRoom[roomId] ?? {};
  const selectedDiff = filePanel.selectedDiff ?? null;
  const historyMessage = historyMessagesByRoom[roomId] ?? null;
  const teamHistoryMessage = teamHistoryMessagesByTeam[selectedTeam || "__no-team"] ?? null;
  const terminalUi: TerminalRoomUiState = terminalRuntime.ui ?? {};
  const pendingAttachments: ChatAttachment[] = roomChat.pendingAttachments ?? [];
  const markdownCopyFallback: MarkdownCopyFallback | null = filePanel.markdownCopyFallback ?? null;

  return {
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    customCodexModel: roomSettings.customCodexModel ?? selectedCodexModel,
    projectPathDraft: roomSettings.projectPathDraft ?? selectedRoom.projectPath,
    messages,
    draft: roomChat.draft ?? "",
    selectedMessages: markdownSelectionMode
      ? messages.filter((message) => selectedMessageIds.includes(message.id))
      : [],
    pendingAttachments,
    roomGoal: codexRuntime.goal ?? null,
    pendingAttachmentBytes: embeddedAttachmentBytes(pendingAttachments),
    browserRequests: browser.requests ?? [],
    browserUrl: browser.url ?? defaultBrowserUrl,
    browserReason: browser.reason ?? defaultBrowserReason,
    activeBrowserUrl: browser.activeUrl ?? null,
    gitStatus: gitWorkflow.status ?? null,
    gitWorkflowDraft: resolveGitWorkflowDraft({ [roomId]: gitWorkflow.draft ?? {} }, roomId),
    gitWorkflowBusy: gitWorkflow.busy ?? false,
    gitWorkflowMessage: gitWorkflow.message ?? null,
    actionRuns: githubActions.runs ?? [],
    actionsBusy: githubActions.busy ?? false,
    actionsLastChecked: githubActions.lastChecked ?? null,
    actionsMessage: githubActions.message ?? null,
    terminalLines: terminalRuntime.lines ?? [],
    terminalBusy: terminalRuntime.busy ?? false,
    selectedTerminalId: terminalRuntime.selectedTerminalId ?? null,
    terminalName: terminalUi.name ?? "dev-server",
    terminalCommand: terminalUi.command ?? "npm run dev:desktop",
    terminalInput: terminalUi.input ?? "",
    terminalError: terminalUi.error ?? null,
    fileQuery: filePanel.query ?? "",
    projectFiles: filePanel.projectFiles ?? [],
    selectedFile: filePanel.selectedFile ?? null,
    selectedDiff,
    filePreviewTab: resolveFilePreviewTab(
      filePanel.previewTab ?? "file",
      Boolean(selectedDiff?.diff.trim())
    ),
    fileBusy: filePanel.busy ?? false,
    fileMessage: filePanel.message ?? null,
    inviteLink: invite.link ?? "",
    inviteApprovalGate: invite.approvalGate ?? false,
    inviteMessage: invite.message ?? null,
    hostMessage: roomSettings.hostMessage ?? null,
    chatMessage: roomChat.message ?? null,
    settingsMessage: roomSettings.settingsMessage ?? null,
    historyMessage,
    teamHistoryMessage,
    visibleHistoryMessage: historyMessage ?? teamHistoryMessage,
    markdownCopyFallback
  };
}

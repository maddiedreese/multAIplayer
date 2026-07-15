import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed
} from "@multaiplayer/protocol";
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
import type { TerminalRuntimeByRoom } from "../store/slices/terminalSlice";
import type { ChatAttachment, ChatMessage, MarkdownCopyFallback } from "../types";

interface UseSelectedRoomValuesOptions {
  selectedRoom: ClientRoomRecord;
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
  const replyToMessageId = roomChat.replyToMessageId ?? null;
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
  const pendingAttachments: ChatAttachment[] = roomChat.pendingAttachments ?? [];
  const markdownCopyFallback: MarkdownCopyFallback | null = filePanel.markdownCopyFallback ?? null;

  return {
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    replyToMessageId,
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
    ...selectBrowserValues(browser, defaultBrowserUrl, defaultBrowserReason),
    ...selectGitValues(gitWorkflow, githubActions, roomId),
    ...selectTerminalValues(terminalRuntime),
    ...selectFilePanelValues(filePanel, selectedDiff),
    inviteLink: invite.link ?? "",
    inviteApprovalGate: invite.approvalGate ?? true,
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

function selectBrowserValues(browser: BrowserByRoom[string], defaultUrl: string, defaultReason: string) {
  return {
    browserRequests: browser.requests ?? [],
    browserUrl: browser.url ?? defaultUrl,
    browserReason: browser.reason ?? defaultReason,
    activeBrowserUrl: browser.activeUrl ?? null,
    browserTabs: browser.tabs ?? [],
    activeBrowserTabId: browser.activeTabId ?? null
  };
}

function selectGitValues(
  gitWorkflow: NonNullable<GitWorkflowRuntimeByRoom[string]["workflow"]>,
  githubActions: NonNullable<GitWorkflowRuntimeByRoom[string]["actions"]>,
  roomId: string
) {
  return {
    gitStatus: gitWorkflow.status ?? null,
    gitWorkflowDraft: resolveGitWorkflowDraft({ [roomId]: gitWorkflow.draft ?? {} }, roomId),
    gitWorkflowBusy: gitWorkflow.busy ?? false,
    gitWorkflowMessage: gitWorkflow.message ?? null,
    actionRuns: githubActions.runs ?? [],
    actionsBusy: githubActions.busy ?? false,
    actionsLastChecked: githubActions.lastChecked ?? null,
    actionsMessage: githubActions.message ?? null
  };
}

function selectTerminalValues(terminalRuntime: TerminalRuntimeByRoom[string]) {
  return {
    terminalLines: terminalRuntime.lines ?? [],
    terminalBusy: terminalRuntime.busy ?? false,
    selectedTerminalId: terminalRuntime.selectedTerminalId ?? null,
    terminalError: terminalRuntime.ui?.error ?? null
  };
}

function selectFilePanelValues(
  filePanel: FilePanelByRoom[string],
  selectedDiff: FilePanelByRoom[string]["selectedDiff"] | null
) {
  return {
    fileQuery: filePanel.query ?? "",
    projectFiles: filePanel.projectFiles ?? [],
    selectedFile: filePanel.selectedFile ?? null,
    selectedDiff,
    filePreviewTab: resolveFilePreviewTab(filePanel.previewTab ?? "file", Boolean(selectedDiff?.diff.trim())),
    fileBusy: filePanel.busy ?? false,
    fileMessage: filePanel.message ?? null,
    fileSaveRequests: filePanel.saveRequests ?? []
  };
}

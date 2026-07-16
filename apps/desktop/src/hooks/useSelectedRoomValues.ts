import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed
} from "@multaiplayer/protocol";
import { resolveFilePreviewTab } from "../lib/files/filePreview";
import { defaultGitWorkflowDraft } from "../lib/git/gitWorkflowDraft";
import { embeddedAttachmentBytes } from "../lib/formatting/appFormatters";
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
  selectedRoom: ClientRoomRecord | null;
  selectedMessageIds: string[];
  markdownSelectionMode: boolean;
  roomSettings: RoomSettingsByRoom[string] | undefined;
  messages: ChatMessage[] | undefined;
  roomChat: RoomChatByRoom[string] | undefined;
  codexRuntime: CodexRuntimeByRoom[string] | undefined;
  browser: BrowserByRoom[string] | undefined;
  gitRuntime: GitWorkflowRuntimeByRoom[string] | undefined;
  terminalRuntime: TerminalRuntimeByRoom[string] | undefined;
  filePanel: FilePanelByRoom[string] | undefined;
  invite: InviteByRoom[string] | undefined;
  historyMessage: string | null | undefined;
  teamHistoryMessage: string | null | undefined;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}

export function useSelectedRoomValues({
  selectedRoom,
  selectedMessageIds,
  markdownSelectionMode,
  roomSettings: roomSettingsInput,
  messages: messagesInput,
  roomChat: roomChatInput,
  codexRuntime: codexRuntimeInput,
  browser: browserInput,
  gitRuntime: gitRuntimeInput,
  terminalRuntime: terminalRuntimeInput,
  filePanel: filePanelInput,
  invite: inviteInput,
  historyMessage: historyMessageInput,
  teamHistoryMessage: teamHistoryMessageInput,
  defaultBrowserUrl,
  defaultBrowserReason
}: UseSelectedRoomValuesOptions) {
  const {
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    selectedProjectPath
  } = selectRoomDefaults(selectedRoom);
  const {
    roomSettings,
    messages,
    roomChat,
    codexRuntime,
    browser,
    gitRuntime,
    terminalRuntime,
    filePanel,
    invite,
    historyMessage,
    teamHistoryMessage
  } = withSelectedRoomDefaults({
    roomSettings: roomSettingsInput,
    messages: messagesInput,
    roomChat: roomChatInput,
    codexRuntime: codexRuntimeInput,
    browser: browserInput,
    gitRuntime: gitRuntimeInput,
    terminalRuntime: terminalRuntimeInput,
    filePanel: filePanelInput,
    invite: inviteInput,
    historyMessage: historyMessageInput,
    teamHistoryMessage: teamHistoryMessageInput
  });
  const replyToMessageId = roomChat.replyToMessageId ?? null;
  const gitWorkflow = gitRuntime.workflow ?? {};
  const githubActions = gitRuntime.actions ?? {};
  const selectedDiff = filePanel.selectedDiff ?? null;
  const pendingAttachments: ChatAttachment[] = roomChat.pendingAttachments ?? [];
  const markdownCopyFallback: MarkdownCopyFallback | null = filePanel.markdownCopyFallback ?? null;

  return {
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    replyToMessageId,
    customCodexModel: roomSettings.customCodexModel ?? selectedCodexModel,
    projectPathDraft: roomSettings.projectPathDraft ?? selectedProjectPath,
    messages,
    draft: roomChat.draft ?? "",
    selectedMessages: markdownSelectionMode
      ? messages.filter((message) => selectedMessageIds.includes(message.id))
      : [],
    pendingAttachments,
    roomGoal: codexRuntime.goal ?? null,
    pendingAttachmentBytes: embeddedAttachmentBytes(pendingAttachments),
    ...selectBrowserValues(browser, defaultBrowserUrl, defaultBrowserReason),
    ...selectGitValues(gitWorkflow, githubActions),
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

function withSelectedRoomDefaults(
  values: Pick<
    UseSelectedRoomValuesOptions,
    | "roomSettings"
    | "messages"
    | "roomChat"
    | "codexRuntime"
    | "browser"
    | "gitRuntime"
    | "terminalRuntime"
    | "filePanel"
    | "invite"
    | "historyMessage"
    | "teamHistoryMessage"
  >
) {
  return {
    roomSettings: values.roomSettings ?? {},
    messages: values.messages ?? [],
    roomChat: values.roomChat ?? {},
    codexRuntime: values.codexRuntime ?? {},
    browser: values.browser ?? {},
    gitRuntime: values.gitRuntime ?? {},
    terminalRuntime: values.terminalRuntime ?? {},
    filePanel: values.filePanel ?? {},
    invite: values.invite ?? {},
    historyMessage: values.historyMessage ?? null,
    teamHistoryMessage: values.teamHistoryMessage ?? null
  };
}

function selectRoomDefaults(room: ClientRoomRecord | null) {
  return {
    selectedCodexModel: room?.codexModel ?? defaultCodexModel,
    selectedCodexReasoningEffort: room?.codexReasoningEffort ?? defaultCodexReasoningEffort,
    selectedCodexSpeed: room?.codexSpeed ?? defaultCodexSpeed,
    selectedCodexSandboxLevel: room?.codexSandboxLevel ?? defaultCodexSandboxLevel,
    selectedProjectPath: room?.projectPath ?? ""
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
  githubActions: NonNullable<GitWorkflowRuntimeByRoom[string]["actions"]>
) {
  return {
    gitStatus: gitWorkflow.status ?? null,
    gitWorkflowDraft: { ...defaultGitWorkflowDraft, ...(gitWorkflow.draft ?? {}) },
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

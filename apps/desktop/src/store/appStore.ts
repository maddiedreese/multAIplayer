import { create } from "zustand";
import type { SetStateAction } from "react";
import type { GitHubActionRun } from "../lib/authClient";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  ProjectFileEntry,
  TerminalSnapshot
} from "../lib/localBackend";
import { updateGitWorkflowDraftRecord, type GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import type {
  BrowserAccessRequest,
  BrowserStatus,
  ChatAttachment,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewDialogState,
  LocalPreviewRecord,
  PendingCodexApproval,
  RoomPresence,
  TerminalCommandRequest
} from "../types";
import type { FilePreviewTab } from "../lib/filePreview";
import type { MarkdownCopyFallback } from "../types";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import type {
  ChatReactionPlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  TeamMemberRecord
} from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

type GitStatusByRoom = Record<string, GitStatusSummary | null>;
type GitWorkflowBusyByRoom = Record<string, boolean>;
type GitWorkflowMessagesByRoom = Record<string, string | null>;
type GitWorkflowDraftsByRoom = Record<string, Partial<GitWorkflowDraft>>;
type ActionsBusyByRoom = Record<string, boolean>;
type ActionsMessagesByRoom = Record<string, string | null>;
type ActionRunsByRoom = Record<string, GitHubActionRun[]>;
type ActionsLastCheckedByRoom = Record<string, string | null>;
type BrowserRequestsByRoom = Record<string, BrowserAccessRequest[]>;
type BrowserUrlsByRoom = Record<string, string>;
type BrowserReasonsByRoom = Record<string, string>;
type BrowserMessagesByRoom = Record<string, string | null>;
type BrowserStatusByRoom = Record<string, BrowserStatus>;
type ActiveBrowserUrlsByRoom = Record<string, string | null>;
type FileQueriesByRoom = Record<string, string>;
type ProjectFilesByRoom = Record<string, ProjectFileEntry[]>;
type SelectedFilesByRoom = Record<string, ProjectFileContent | null>;
type SelectedDiffsByRoom = Record<string, GitDiffResult | null>;
type FilePreviewTabsByRoom = Record<string, FilePreviewTab>;
type FileBusyByRoom = Record<string, boolean>;
type FileMessagesByRoom = Record<string, string | null>;
type MarkdownCopyFallbacksByRoom = Record<string, MarkdownCopyFallback | null>;
type HostBusyByRoom = Record<string, boolean>;
type HostMessagesByRoom = Record<string, string | null>;
type SettingsBusyByRoom = Record<string, boolean>;
type SettingsMessagesByRoom = Record<string, string | null>;
type CustomCodexModelsByRoom = Record<string, string>;
type ProjectPathDraftsByRoom = Record<string, string>;
type LocalPreviewsByRoom = Record<string, LocalPreviewRecord[]>;
type LocalPreviewBusyByRoom = Record<string, boolean>;
type InviteRequestsByRoom = Record<string, InviteJoinRequest[]>;
type InviteLinksByRoom = Record<string, string>;
type InviteApprovalGatesByRoom = Record<string, boolean>;
type InviteMessagesByRoom = Record<string, string | null>;
type KeyRotationBusyByRoom = Record<string, boolean>;
type InviteAdmissionsByRoom = Record<string, string>;
type ChatMessagesByRoom = Record<string, string | null>;
type DraftsByRoom = Record<string, string>;
type PendingAttachmentsByRoom = Record<string, ChatAttachment[]>;
type CodexEventsByRoom = Record<string, CodexRoomEvent[]>;
type ApprovalVisibleByRoom = Record<string, boolean>;
type PendingCodexApprovalsByRoom = Record<string, PendingCodexApproval>;
type CodexRunningByRoom = Record<string, boolean>;
type SecretWarningsVisibleByRoom = Record<string, boolean>;
type CodexThreadIdsByRoom = Record<string, string>;
type SelectedMessageIdsByRoom = Record<string, string[]>;
type HistorySearchMessagesByRoom = Record<string, ChatMessage[]>;
type HistoryMessagesByRoom = Record<string, string | null>;
type TeamHistoryMessagesByTeam = Record<string, string | null>;
type InspectorTabsByRoom = Record<string, InspectorTab>;
type PresenceByRoom = Record<string, Record<string, RoomPresence>>;
type HostHandoffsByRoom = Record<string, HostHandoffRecord[]>;
type CodexContinuationByRoom = Record<string, HostHandoffRecord>;
type GitWorkflowEventsByRoom = Record<string, GitWorkflowEventPlaintextPayload[]>;
type GitHubActionsEventsByRoom = Record<string, GitHubActionsEventPlaintextPayload[]>;
type TerminalLinesByRoom = Record<string, string[]>;
type TerminalBusyByRoom = Record<string, boolean>;
type Terminals = TerminalSnapshot[];
type TerminalRequestsByRoom = Record<string, TerminalCommandRequest[]>;
type SelectedTerminalIdsByRoom = Record<string, string | null>;
type TerminalNamesByRoom = Record<string, string>;
type TerminalCommandsByRoom = Record<string, string>;
type TerminalInputsByRoom = Record<string, string>;
type TerminalErrorsByRoom = Record<string, string | null>;
type TeamMembersByTeam = Record<string, TeamMemberRecord[]>;
type TeamMembersMessageByTeam = Record<string, string | null>;
type TeamMembersBusyByTeam = Record<string, boolean>;
type MessagesByRoom = Record<string, ChatMessage[]>;
type RoomBusyByRoom = Record<string, boolean>;

const emptyLocalPreviewDialog: LocalPreviewDialogState = {
  open: false,
  phase: "select",
  roomId: "",
  candidates: [],
  selectedUrl: "",
  manualUrl: "",
  error: null,
  cloudflaredVersion: null
};

const emptyAppStoreState = {
  gitStatusByRoom: {},
  gitWorkflowBusyByRoom: {},
  gitWorkflowMessagesByRoom: {},
  gitWorkflowDraftsByRoom: {},
  actionsBusyByRoom: {},
  actionsMessagesByRoom: {},
  actionRunsByRoom: {},
  actionsLastCheckedByRoom: {},
  browserRequestsByRoom: {},
  browserUrlsByRoom: {},
  browserReasonsByRoom: {},
  browserMessagesByRoom: {},
  browserStatusByRoom: {},
  activeBrowserUrlsByRoom: {},
  fileQueriesByRoom: {},
  projectFilesByRoom: {},
  selectedFilesByRoom: {},
  selectedDiffsByRoom: {},
  filePreviewTabsByRoom: {},
  fileBusyByRoom: {},
  fileMessagesByRoom: {},
  markdownCopyFallbacksByRoom: {},
  hostBusyByRoom: {},
  hostMessagesByRoom: {},
  settingsBusyByRoom: {},
  settingsMessagesByRoom: {},
  customCodexModelsByRoom: {},
  projectPathDraftsByRoom: {},
  localPreviewsByRoom: {},
  localPreviewDialog: emptyLocalPreviewDialog,
  localPreviewBusyByRoom: {},
  inviteRequestsByRoom: {},
  inviteSecretInput: "",
  inviteLinksByRoom: {},
  inviteApprovalGatesByRoom: {},
  inviteMessagesByRoom: {},
  keyRotationBusyByRoom: {},
  inviteAdmissionsByRoom: {},
  chatMessagesByRoom: {},
  draftsByRoom: {},
  pendingAttachmentsByRoom: {},
  sensitiveAttachmentReviewKey: null,
  codexEventsByRoom: {},
  approvalVisibleByRoom: {},
  pendingCodexApprovalsByRoom: {},
  codexRunningByRoom: {},
  secretWarningsVisibleByRoom: {},
  codexThreadIdsByRoom: {},
  selectedMessageIdsByRoom: {},
  historySearchMessagesByRoom: {},
  historyMessagesByRoom: {},
  teamHistoryMessagesByTeam: {},
  inspectorTabsByRoom: {},
  presenceByRoom: {},
  hostHandoffsByRoom: {},
  codexContinuationByRoom: {},
  gitWorkflowEventsByRoom: {},
  githubActionsEventsByRoom: {},
  terminalLinesByRoom: {},
  terminalBusyByRoom: {},
  terminals: [],
  terminalRequestsByRoom: {},
  selectedTerminalIdsByRoom: {},
  terminalNamesByRoom: {},
  terminalCommandsByRoom: {},
  terminalInputsByRoom: {},
  terminalErrorsByRoom: {},
  teamMembersByTeam: {},
  teamMembersMessageByTeam: {},
  teamMembersBusyByTeam: {},
  messagesByRoom: {}
};

function resolveSetStateAction<T>(current: T, action: SetStateAction<T>): T {
  return typeof action === "function" ? (action as (current: T) => T)(current) : action;
}

function updateRoomBusyMap(current: RoomBusyByRoom, roomId: string, busy: boolean): RoomBusyByRoom {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

interface AppStoreState {
  gitStatusByRoom: GitStatusByRoom;
  gitWorkflowBusyByRoom: GitWorkflowBusyByRoom;
  gitWorkflowMessagesByRoom: GitWorkflowMessagesByRoom;
  gitWorkflowDraftsByRoom: GitWorkflowDraftsByRoom;
  actionsBusyByRoom: ActionsBusyByRoom;
  actionsMessagesByRoom: ActionsMessagesByRoom;
  actionRunsByRoom: ActionRunsByRoom;
  actionsLastCheckedByRoom: ActionsLastCheckedByRoom;
  browserRequestsByRoom: BrowserRequestsByRoom;
  browserUrlsByRoom: BrowserUrlsByRoom;
  browserReasonsByRoom: BrowserReasonsByRoom;
  browserMessagesByRoom: BrowserMessagesByRoom;
  browserStatusByRoom: BrowserStatusByRoom;
  activeBrowserUrlsByRoom: ActiveBrowserUrlsByRoom;
  fileQueriesByRoom: FileQueriesByRoom;
  projectFilesByRoom: ProjectFilesByRoom;
  selectedFilesByRoom: SelectedFilesByRoom;
  selectedDiffsByRoom: SelectedDiffsByRoom;
  filePreviewTabsByRoom: FilePreviewTabsByRoom;
  fileBusyByRoom: FileBusyByRoom;
  fileMessagesByRoom: FileMessagesByRoom;
  markdownCopyFallbacksByRoom: MarkdownCopyFallbacksByRoom;
  hostBusyByRoom: HostBusyByRoom;
  hostMessagesByRoom: HostMessagesByRoom;
  settingsBusyByRoom: SettingsBusyByRoom;
  settingsMessagesByRoom: SettingsMessagesByRoom;
  customCodexModelsByRoom: CustomCodexModelsByRoom;
  projectPathDraftsByRoom: ProjectPathDraftsByRoom;
  localPreviewsByRoom: LocalPreviewsByRoom;
  localPreviewDialog: LocalPreviewDialogState;
  localPreviewBusyByRoom: LocalPreviewBusyByRoom;
  inviteRequestsByRoom: InviteRequestsByRoom;
  inviteSecretInput: string;
  inviteLinksByRoom: InviteLinksByRoom;
  inviteApprovalGatesByRoom: InviteApprovalGatesByRoom;
  inviteMessagesByRoom: InviteMessagesByRoom;
  keyRotationBusyByRoom: KeyRotationBusyByRoom;
  inviteAdmissionsByRoom: InviteAdmissionsByRoom;
  chatMessagesByRoom: ChatMessagesByRoom;
  draftsByRoom: DraftsByRoom;
  pendingAttachmentsByRoom: PendingAttachmentsByRoom;
  sensitiveAttachmentReviewKey: string | null;
  codexEventsByRoom: CodexEventsByRoom;
  approvalVisibleByRoom: ApprovalVisibleByRoom;
  pendingCodexApprovalsByRoom: PendingCodexApprovalsByRoom;
  codexRunningByRoom: CodexRunningByRoom;
  secretWarningsVisibleByRoom: SecretWarningsVisibleByRoom;
  codexThreadIdsByRoom: CodexThreadIdsByRoom;
  selectedMessageIdsByRoom: SelectedMessageIdsByRoom;
  historySearchMessagesByRoom: HistorySearchMessagesByRoom;
  historyMessagesByRoom: HistoryMessagesByRoom;
  teamHistoryMessagesByTeam: TeamHistoryMessagesByTeam;
  inspectorTabsByRoom: InspectorTabsByRoom;
  presenceByRoom: PresenceByRoom;
  hostHandoffsByRoom: HostHandoffsByRoom;
  codexContinuationByRoom: CodexContinuationByRoom;
  gitWorkflowEventsByRoom: GitWorkflowEventsByRoom;
  githubActionsEventsByRoom: GitHubActionsEventsByRoom;
  terminalLinesByRoom: TerminalLinesByRoom;
  terminalBusyByRoom: TerminalBusyByRoom;
  terminals: Terminals;
  terminalRequestsByRoom: TerminalRequestsByRoom;
  selectedTerminalIdsByRoom: SelectedTerminalIdsByRoom;
  terminalNamesByRoom: TerminalNamesByRoom;
  terminalCommandsByRoom: TerminalCommandsByRoom;
  terminalInputsByRoom: TerminalInputsByRoom;
  terminalErrorsByRoom: TerminalErrorsByRoom;
  teamMembersByTeam: TeamMembersByTeam;
  teamMembersMessageByTeam: TeamMembersMessageByTeam;
  teamMembersBusyByTeam: TeamMembersBusyByTeam;
  messagesByRoom: MessagesByRoom;
  setGitStatusByRoom: (action: SetStateAction<GitStatusByRoom>) => void;
  setGitWorkflowBusyByRoom: (action: SetStateAction<GitWorkflowBusyByRoom>) => void;
  setGitWorkflowMessagesByRoom: (action: SetStateAction<GitWorkflowMessagesByRoom>) => void;
  setGitWorkflowDraftsByRoom: (action: SetStateAction<GitWorkflowDraftsByRoom>) => void;
  setActionsBusyByRoom: (action: SetStateAction<ActionsBusyByRoom>) => void;
  setActionsMessagesByRoom: (action: SetStateAction<ActionsMessagesByRoom>) => void;
  setActionRunsByRoom: (action: SetStateAction<ActionRunsByRoom>) => void;
  setActionsLastCheckedByRoom: (action: SetStateAction<ActionsLastCheckedByRoom>) => void;
  setBrowserRequestsByRoom: (action: SetStateAction<BrowserRequestsByRoom>) => void;
  setBrowserUrlsByRoom: (action: SetStateAction<BrowserUrlsByRoom>) => void;
  setBrowserReasonsByRoom: (action: SetStateAction<BrowserReasonsByRoom>) => void;
  setBrowserMessagesByRoom: (action: SetStateAction<BrowserMessagesByRoom>) => void;
  setBrowserStatusByRoom: (action: SetStateAction<BrowserStatusByRoom>) => void;
  setActiveBrowserUrlsByRoom: (action: SetStateAction<ActiveBrowserUrlsByRoom>) => void;
  setFileQueriesByRoom: (action: SetStateAction<FileQueriesByRoom>) => void;
  setProjectFilesByRoom: (action: SetStateAction<ProjectFilesByRoom>) => void;
  setSelectedFilesByRoom: (action: SetStateAction<SelectedFilesByRoom>) => void;
  setSelectedDiffsByRoom: (action: SetStateAction<SelectedDiffsByRoom>) => void;
  setFilePreviewTabsByRoom: (action: SetStateAction<FilePreviewTabsByRoom>) => void;
  setFileBusyByRoom: (action: SetStateAction<FileBusyByRoom>) => void;
  setFileMessagesByRoom: (action: SetStateAction<FileMessagesByRoom>) => void;
  setMarkdownCopyFallbacksByRoom: (action: SetStateAction<MarkdownCopyFallbacksByRoom>) => void;
  setHostBusyByRoom: (action: SetStateAction<HostBusyByRoom>) => void;
  setHostMessagesByRoom: (action: SetStateAction<HostMessagesByRoom>) => void;
  setSettingsBusyByRoom: (action: SetStateAction<SettingsBusyByRoom>) => void;
  setSettingsMessagesByRoom: (action: SetStateAction<SettingsMessagesByRoom>) => void;
  setCustomCodexModelsByRoom: (action: SetStateAction<CustomCodexModelsByRoom>) => void;
  setProjectPathDraftsByRoom: (action: SetStateAction<ProjectPathDraftsByRoom>) => void;
  setLocalPreviewsByRoom: (action: SetStateAction<LocalPreviewsByRoom>) => void;
  setLocalPreviewDialog: (action: SetStateAction<LocalPreviewDialogState>) => void;
  setLocalPreviewBusyByRoom: (action: SetStateAction<LocalPreviewBusyByRoom>) => void;
  setInviteRequestsByRoom: (action: SetStateAction<InviteRequestsByRoom>) => void;
  setInviteSecretInput: (action: SetStateAction<string>) => void;
  setInviteLinksByRoom: (action: SetStateAction<InviteLinksByRoom>) => void;
  setInviteApprovalGatesByRoom: (action: SetStateAction<InviteApprovalGatesByRoom>) => void;
  setInviteMessagesByRoom: (action: SetStateAction<InviteMessagesByRoom>) => void;
  setKeyRotationBusyByRoom: (action: SetStateAction<KeyRotationBusyByRoom>) => void;
  setInviteAdmissionsByRoom: (action: SetStateAction<InviteAdmissionsByRoom>) => void;
  setChatMessagesByRoom: (action: SetStateAction<ChatMessagesByRoom>) => void;
  setDraftsByRoom: (action: SetStateAction<DraftsByRoom>) => void;
  setPendingAttachmentsByRoom: (action: SetStateAction<PendingAttachmentsByRoom>) => void;
  setSensitiveAttachmentReviewKey: (action: SetStateAction<string | null>) => void;
  setCodexEventsByRoom: (action: SetStateAction<CodexEventsByRoom>) => void;
  setApprovalVisibleByRoom: (action: SetStateAction<ApprovalVisibleByRoom>) => void;
  setPendingCodexApprovalsByRoom: (action: SetStateAction<PendingCodexApprovalsByRoom>) => void;
  setCodexRunningByRoom: (action: SetStateAction<CodexRunningByRoom>) => void;
  setSecretWarningsVisibleByRoom: (action: SetStateAction<SecretWarningsVisibleByRoom>) => void;
  setCodexThreadIdsByRoom: (action: SetStateAction<CodexThreadIdsByRoom>) => void;
  setSelectedMessageIdsByRoom: (action: SetStateAction<SelectedMessageIdsByRoom>) => void;
  setHistorySearchMessagesByRoom: (action: SetStateAction<HistorySearchMessagesByRoom>) => void;
  setHistoryMessagesByRoom: (action: SetStateAction<HistoryMessagesByRoom>) => void;
  setTeamHistoryMessagesByTeam: (action: SetStateAction<TeamHistoryMessagesByTeam>) => void;
  setInspectorTabsByRoom: (action: SetStateAction<InspectorTabsByRoom>) => void;
  setPresenceByRoom: (action: SetStateAction<PresenceByRoom>) => void;
  setHostHandoffsByRoom: (action: SetStateAction<HostHandoffsByRoom>) => void;
  setCodexContinuationByRoom: (action: SetStateAction<CodexContinuationByRoom>) => void;
  setGitWorkflowEventsByRoom: (action: SetStateAction<GitWorkflowEventsByRoom>) => void;
  setGitHubActionsEventsByRoom: (action: SetStateAction<GitHubActionsEventsByRoom>) => void;
  setTerminalLinesByRoom: (action: SetStateAction<TerminalLinesByRoom>) => void;
  setTerminalBusyByRoom: (action: SetStateAction<TerminalBusyByRoom>) => void;
  setTerminals: (action: SetStateAction<Terminals>) => void;
  setTerminalRequestsByRoom: (action: SetStateAction<TerminalRequestsByRoom>) => void;
  setSelectedTerminalIdsByRoom: (action: SetStateAction<SelectedTerminalIdsByRoom>) => void;
  setTerminalNamesByRoom: (action: SetStateAction<TerminalNamesByRoom>) => void;
  setTerminalCommandsByRoom: (action: SetStateAction<TerminalCommandsByRoom>) => void;
  setTerminalInputsByRoom: (action: SetStateAction<TerminalInputsByRoom>) => void;
  setTerminalErrorsByRoom: (action: SetStateAction<TerminalErrorsByRoom>) => void;
  setTeamMembersByTeam: (action: SetStateAction<TeamMembersByTeam>) => void;
  setTeamMembersMessageByTeam: (action: SetStateAction<TeamMembersMessageByTeam>) => void;
  setTeamMembersBusyByTeam: (action: SetStateAction<TeamMembersBusyByTeam>) => void;
  setMessagesByRoom: (action: SetStateAction<MessagesByRoom>) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
  setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) => void;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  setLocalPreviewBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setKeyRotationBusyForRoom: (roomId: string, busy: boolean) => void;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setTerminalBusyForRoom: (roomId: string, busy: boolean) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendTerminalRequest: (roomId: string, request: TerminalCommandRequest) => void;
  updateTerminalRequestStatus: (roomId: string, requestId: string, status: TerminalCommandRequest["status"]) => void;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  markHostHandoffAcceptedForRoom: (roomId: string, handoffId: string) => void;
  markLatestHostHandoffAcceptedForRoom: (roomId: string) => void;
  setCodexContinuationForRoom: (roomId: string, handoff: HostHandoffRecord | null) => void;
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  setCodexThreadIdForRoom: (roomId: string, threadId: string | null) => void;
  setFileQueryForRoom: (roomId: string, query: string) => void;
  setProjectFilesForRoom: (roomId: string, files: ProjectFileEntry[]) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: GitDiffResult | null) => void;
  setFilePreviewTabForRoom: (roomId: string, tab: FilePreviewTab) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  resetFileContextForRoom: (roomId: string) => void;
  setSelectedTerminalIdForRoom: (roomId: string, terminalId: string | null) => void;
  setTerminalNameForRoom: (roomId: string, name: string) => void;
  setTerminalCommandForRoom: (roomId: string, command: string) => void;
  setTerminalInputForRoom: (roomId: string, input: string) => void;
  setTerminalErrorForRoom: (roomId: string, error: string | null) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[], maxTerminalActivityLines: number) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setMarkdownCopyFallbackForRoom: (roomId: string, fallback: MarkdownCopyFallback | null) => void;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
  setHistoryMessageForRoom: (roomId: string, message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  updateGitWorkflowDraftForRoom: (roomId: string, patch: Partial<GitWorkflowDraft>) => void;
  setBrowserUrlForRoom: (roomId: string, url: string, defaultBrowserUrl: string) => void;
  setBrowserReasonForRoom: (roomId: string, reason: string, defaultBrowserReason: string) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteApprovalGateForRoom: (roomId: string, enabled: boolean) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setCustomCodexModelForRoom: (roomId: string, model: string, currentModel: string) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string, currentProjectPath: string) => void;
  setPendingAttachmentsForRoom: (
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) => void;
  setDraftForRoom: (roomId: string, value: string) => void;
  clearRoomScopedStateForRoom: (roomId: string) => void;
  resetAppStore: () => void;
  resetGitWorkflowState: () => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  ...emptyAppStoreState,
  setGitStatusByRoom: (action) => {
    set((state) => ({
      gitStatusByRoom: resolveSetStateAction(state.gitStatusByRoom, action)
    }));
  },
  setGitWorkflowBusyByRoom: (action) => {
    set((state) => ({
      gitWorkflowBusyByRoom: resolveSetStateAction(state.gitWorkflowBusyByRoom, action)
    }));
  },
  setGitWorkflowMessagesByRoom: (action) => {
    set((state) => ({
      gitWorkflowMessagesByRoom: resolveSetStateAction(state.gitWorkflowMessagesByRoom, action)
    }));
  },
  setGitWorkflowDraftsByRoom: (action) => {
    set((state) => ({
      gitWorkflowDraftsByRoom: resolveSetStateAction(state.gitWorkflowDraftsByRoom, action)
    }));
  },
  setActionsBusyByRoom: (action) => {
    set((state) => ({
      actionsBusyByRoom: resolveSetStateAction(state.actionsBusyByRoom, action)
    }));
  },
  setActionsMessagesByRoom: (action) => {
    set((state) => ({
      actionsMessagesByRoom: resolveSetStateAction(state.actionsMessagesByRoom, action)
    }));
  },
  setActionRunsByRoom: (action) => {
    set((state) => ({
      actionRunsByRoom: resolveSetStateAction(state.actionRunsByRoom, action)
    }));
  },
  setActionsLastCheckedByRoom: (action) => {
    set((state) => ({
      actionsLastCheckedByRoom: resolveSetStateAction(state.actionsLastCheckedByRoom, action)
    }));
  },
  setBrowserRequestsByRoom: (action) => {
    set((state) => ({
      browserRequestsByRoom: resolveSetStateAction(state.browserRequestsByRoom, action)
    }));
  },
  setBrowserUrlsByRoom: (action) => {
    set((state) => ({
      browserUrlsByRoom: resolveSetStateAction(state.browserUrlsByRoom, action)
    }));
  },
  setBrowserReasonsByRoom: (action) => {
    set((state) => ({
      browserReasonsByRoom: resolveSetStateAction(state.browserReasonsByRoom, action)
    }));
  },
  setBrowserMessagesByRoom: (action) => {
    set((state) => ({
      browserMessagesByRoom: resolveSetStateAction(state.browserMessagesByRoom, action)
    }));
  },
  setBrowserStatusByRoom: (action) => {
    set((state) => ({
      browserStatusByRoom: resolveSetStateAction(state.browserStatusByRoom, action)
    }));
  },
  setActiveBrowserUrlsByRoom: (action) => {
    set((state) => ({
      activeBrowserUrlsByRoom: resolveSetStateAction(state.activeBrowserUrlsByRoom, action)
    }));
  },
  setFileQueriesByRoom: (action) => {
    set((state) => ({
      fileQueriesByRoom: resolveSetStateAction(state.fileQueriesByRoom, action)
    }));
  },
  setProjectFilesByRoom: (action) => {
    set((state) => ({
      projectFilesByRoom: resolveSetStateAction(state.projectFilesByRoom, action)
    }));
  },
  setSelectedFilesByRoom: (action) => {
    set((state) => ({
      selectedFilesByRoom: resolveSetStateAction(state.selectedFilesByRoom, action)
    }));
  },
  setSelectedDiffsByRoom: (action) => {
    set((state) => ({
      selectedDiffsByRoom: resolveSetStateAction(state.selectedDiffsByRoom, action)
    }));
  },
  setFilePreviewTabsByRoom: (action) => {
    set((state) => ({
      filePreviewTabsByRoom: resolveSetStateAction(state.filePreviewTabsByRoom, action)
    }));
  },
  setFileBusyByRoom: (action) => {
    set((state) => ({
      fileBusyByRoom: resolveSetStateAction(state.fileBusyByRoom, action)
    }));
  },
  setFileMessagesByRoom: (action) => {
    set((state) => ({
      fileMessagesByRoom: resolveSetStateAction(state.fileMessagesByRoom, action)
    }));
  },
  setMarkdownCopyFallbacksByRoom: (action) => {
    set((state) => ({
      markdownCopyFallbacksByRoom: resolveSetStateAction(state.markdownCopyFallbacksByRoom, action)
    }));
  },
  setHostBusyByRoom: (action) => {
    set((state) => ({
      hostBusyByRoom: resolveSetStateAction(state.hostBusyByRoom, action)
    }));
  },
  setHostMessagesByRoom: (action) => {
    set((state) => ({
      hostMessagesByRoom: resolveSetStateAction(state.hostMessagesByRoom, action)
    }));
  },
  setSettingsBusyByRoom: (action) => {
    set((state) => ({
      settingsBusyByRoom: resolveSetStateAction(state.settingsBusyByRoom, action)
    }));
  },
  setSettingsMessagesByRoom: (action) => {
    set((state) => ({
      settingsMessagesByRoom: resolveSetStateAction(state.settingsMessagesByRoom, action)
    }));
  },
  setCustomCodexModelsByRoom: (action) => {
    set((state) => ({
      customCodexModelsByRoom: resolveSetStateAction(state.customCodexModelsByRoom, action)
    }));
  },
  setProjectPathDraftsByRoom: (action) => {
    set((state) => ({
      projectPathDraftsByRoom: resolveSetStateAction(state.projectPathDraftsByRoom, action)
    }));
  },
  setLocalPreviewsByRoom: (action) => {
    set((state) => ({
      localPreviewsByRoom: resolveSetStateAction(state.localPreviewsByRoom, action)
    }));
  },
  setLocalPreviewDialog: (action) => {
    set((state) => ({
      localPreviewDialog: resolveSetStateAction(state.localPreviewDialog, action)
    }));
  },
  setLocalPreviewBusyByRoom: (action) => {
    set((state) => ({
      localPreviewBusyByRoom: resolveSetStateAction(state.localPreviewBusyByRoom, action)
    }));
  },
  setInviteRequestsByRoom: (action) => {
    set((state) => ({
      inviteRequestsByRoom: resolveSetStateAction(state.inviteRequestsByRoom, action)
    }));
  },
  setInviteSecretInput: (action) => {
    set((state) => ({
      inviteSecretInput: resolveSetStateAction(state.inviteSecretInput, action)
    }));
  },
  setInviteLinksByRoom: (action) => {
    set((state) => ({
      inviteLinksByRoom: resolveSetStateAction(state.inviteLinksByRoom, action)
    }));
  },
  setInviteApprovalGatesByRoom: (action) => {
    set((state) => ({
      inviteApprovalGatesByRoom: resolveSetStateAction(state.inviteApprovalGatesByRoom, action)
    }));
  },
  setInviteMessagesByRoom: (action) => {
    set((state) => ({
      inviteMessagesByRoom: resolveSetStateAction(state.inviteMessagesByRoom, action)
    }));
  },
  setKeyRotationBusyByRoom: (action) => {
    set((state) => ({
      keyRotationBusyByRoom: resolveSetStateAction(state.keyRotationBusyByRoom, action)
    }));
  },
  setInviteAdmissionsByRoom: (action) => {
    set((state) => ({
      inviteAdmissionsByRoom: resolveSetStateAction(state.inviteAdmissionsByRoom, action)
    }));
  },
  setChatMessagesByRoom: (action) => {
    set((state) => ({
      chatMessagesByRoom: resolveSetStateAction(state.chatMessagesByRoom, action)
    }));
  },
  setDraftsByRoom: (action) => {
    set((state) => ({
      draftsByRoom: resolveSetStateAction(state.draftsByRoom, action)
    }));
  },
  setPendingAttachmentsByRoom: (action) => {
    set((state) => ({
      pendingAttachmentsByRoom: resolveSetStateAction(state.pendingAttachmentsByRoom, action)
    }));
  },
  setSensitiveAttachmentReviewKey: (action) => {
    set((state) => ({
      sensitiveAttachmentReviewKey: resolveSetStateAction(state.sensitiveAttachmentReviewKey, action)
    }));
  },
  setCodexEventsByRoom: (action) => {
    set((state) => ({
      codexEventsByRoom: resolveSetStateAction(state.codexEventsByRoom, action)
    }));
  },
  setApprovalVisibleByRoom: (action) => {
    set((state) => ({
      approvalVisibleByRoom: resolveSetStateAction(state.approvalVisibleByRoom, action)
    }));
  },
  setPendingCodexApprovalsByRoom: (action) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: resolveSetStateAction(state.pendingCodexApprovalsByRoom, action)
    }));
  },
  setCodexRunningByRoom: (action) => {
    set((state) => ({
      codexRunningByRoom: resolveSetStateAction(state.codexRunningByRoom, action)
    }));
  },
  setSecretWarningsVisibleByRoom: (action) => {
    set((state) => ({
      secretWarningsVisibleByRoom: resolveSetStateAction(state.secretWarningsVisibleByRoom, action)
    }));
  },
  setCodexThreadIdsByRoom: (action) => {
    set((state) => ({
      codexThreadIdsByRoom: resolveSetStateAction(state.codexThreadIdsByRoom, action)
    }));
  },
  setSelectedMessageIdsByRoom: (action) => {
    set((state) => ({
      selectedMessageIdsByRoom: resolveSetStateAction(state.selectedMessageIdsByRoom, action)
    }));
  },
  setHistorySearchMessagesByRoom: (action) => {
    set((state) => ({
      historySearchMessagesByRoom: resolveSetStateAction(state.historySearchMessagesByRoom, action)
    }));
  },
  setHistoryMessagesByRoom: (action) => {
    set((state) => ({
      historyMessagesByRoom: resolveSetStateAction(state.historyMessagesByRoom, action)
    }));
  },
  setTeamHistoryMessagesByTeam: (action) => {
    set((state) => ({
      teamHistoryMessagesByTeam: resolveSetStateAction(state.teamHistoryMessagesByTeam, action)
    }));
  },
  setInspectorTabsByRoom: (action) => {
    set((state) => ({
      inspectorTabsByRoom: resolveSetStateAction(state.inspectorTabsByRoom, action)
    }));
  },
  setPresenceByRoom: (action) => {
    set((state) => ({
      presenceByRoom: resolveSetStateAction(state.presenceByRoom, action)
    }));
  },
  setHostHandoffsByRoom: (action) => {
    set((state) => ({
      hostHandoffsByRoom: resolveSetStateAction(state.hostHandoffsByRoom, action)
    }));
  },
  setCodexContinuationByRoom: (action) => {
    set((state) => ({
      codexContinuationByRoom: resolveSetStateAction(state.codexContinuationByRoom, action)
    }));
  },
  setGitWorkflowEventsByRoom: (action) => {
    set((state) => ({
      gitWorkflowEventsByRoom: resolveSetStateAction(state.gitWorkflowEventsByRoom, action)
    }));
  },
  setGitHubActionsEventsByRoom: (action) => {
    set((state) => ({
      githubActionsEventsByRoom: resolveSetStateAction(state.githubActionsEventsByRoom, action)
    }));
  },
  setTerminalLinesByRoom: (action) => {
    set((state) => ({
      terminalLinesByRoom: resolveSetStateAction(state.terminalLinesByRoom, action)
    }));
  },
  setTerminalBusyByRoom: (action) => {
    set((state) => ({
      terminalBusyByRoom: resolveSetStateAction(state.terminalBusyByRoom, action)
    }));
  },
  setTerminals: (action) => {
    set((state) => ({
      terminals: resolveSetStateAction(state.terminals, action)
    }));
  },
  setTerminalRequestsByRoom: (action) => {
    set((state) => ({
      terminalRequestsByRoom: resolveSetStateAction(state.terminalRequestsByRoom, action)
    }));
  },
  setSelectedTerminalIdsByRoom: (action) => {
    set((state) => ({
      selectedTerminalIdsByRoom: resolveSetStateAction(state.selectedTerminalIdsByRoom, action)
    }));
  },
  setTerminalNamesByRoom: (action) => {
    set((state) => ({
      terminalNamesByRoom: resolveSetStateAction(state.terminalNamesByRoom, action)
    }));
  },
  setTerminalCommandsByRoom: (action) => {
    set((state) => ({
      terminalCommandsByRoom: resolveSetStateAction(state.terminalCommandsByRoom, action)
    }));
  },
  setTerminalInputsByRoom: (action) => {
    set((state) => ({
      terminalInputsByRoom: resolveSetStateAction(state.terminalInputsByRoom, action)
    }));
  },
  setTerminalErrorsByRoom: (action) => {
    set((state) => ({
      terminalErrorsByRoom: resolveSetStateAction(state.terminalErrorsByRoom, action)
    }));
  },
  setTeamMembersByTeam: (action) => {
    set((state) => ({
      teamMembersByTeam: resolveSetStateAction(state.teamMembersByTeam, action)
    }));
  },
  setTeamMembersMessageByTeam: (action) => {
    set((state) => ({
      teamMembersMessageByTeam: resolveSetStateAction(state.teamMembersMessageByTeam, action)
    }));
  },
  setTeamMembersBusyByTeam: (action) => {
    set((state) => ({
      teamMembersBusyByTeam: resolveSetStateAction(state.teamMembersBusyByTeam, action)
    }));
  },
  setMessagesByRoom: (action) => {
    set((state) => ({
      messagesByRoom: resolveSetStateAction(state.messagesByRoom, action)
    }));
  },
  appendRoomMessage: (roomId, message) => {
    set((state) => {
      const roomMessages = state.messagesByRoom[roomId] ?? [];
      if (roomMessages.some((existing) => existing.id === message.id)) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: [...roomMessages, message]
        }
      };
    });
  },
  applyMessageReaction: (roomId, reaction) => {
    set((state) => {
      const roomMessages = state.messagesByRoom[roomId] ?? [];
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: roomMessages.map((message) => {
            if (message.id !== reaction.messageId) return message;
            const reactions = message.reactions ?? [];
            const existing = reactions.find((item) => item.emoji === reaction.emoji);
            const reactors = existing?.reactors.filter((reactor) => reactor.userId !== reaction.reactorUserId) ?? [];
            const nextReactors = reaction.action === "add"
              ? [...reactors, { userId: reaction.reactorUserId, name: reaction.reactor }]
              : reactors;
            return {
              ...message,
              reactions: [
                ...reactions.filter((item) => item.emoji !== reaction.emoji),
                ...(nextReactors.length ? [{ emoji: reaction.emoji, reactors: nextReactors }] : [])
              ]
            };
          })
        }
      };
    });
  },
  setGitWorkflowBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowBusyByRoom: updateRoomBusyMap(state.gitWorkflowBusyByRoom, roomId, busy)
    }));
  },
  setActionsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      actionsBusyByRoom: updateRoomBusyMap(state.actionsBusyByRoom, roomId, busy)
    }));
  },
  setLocalPreviewBusyForRoom: (roomId, busy) => {
    set((state) => ({
      localPreviewBusyByRoom: updateRoomBusyMap(state.localPreviewBusyByRoom, roomId, busy)
    }));
  },
  setHostBusyForRoom: (roomId, busy) => {
    set((state) => ({
      hostBusyByRoom: updateRoomBusyMap(state.hostBusyByRoom, roomId, busy)
    }));
  },
  setSettingsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      settingsBusyByRoom: updateRoomBusyMap(state.settingsBusyByRoom, roomId, busy)
    }));
  },
  setKeyRotationBusyForRoom: (roomId, busy) => {
    set((state) => ({
      keyRotationBusyByRoom: updateRoomBusyMap(state.keyRotationBusyByRoom, roomId, busy)
    }));
  },
  setFileBusyForRoom: (roomId, busy) => {
    set((state) => ({
      fileBusyByRoom: updateRoomBusyMap(state.fileBusyByRoom, roomId, busy)
    }));
  },
  setTerminalBusyForRoom: (roomId, busy) => {
    set((state) => ({
      terminalBusyByRoom: updateRoomBusyMap(state.terminalBusyByRoom, roomId, busy)
    }));
  },
  updateInviteRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      inviteRequestsByRoom: {
        ...state.inviteRequestsByRoom,
        [roomId]: (state.inviteRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  appendTerminalRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.terminalRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        terminalRequestsByRoom: {
          ...state.terminalRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  updateTerminalRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      terminalRequestsByRoom: {
        ...state.terminalRequestsByRoom,
        [roomId]: (state.terminalRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  appendBrowserRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.browserRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        browserRequestsByRoom: {
          ...state.browserRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  updateBrowserRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      browserRequestsByRoom: {
        ...state.browserRequestsByRoom,
        [roomId]: (state.browserRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  appendGitWorkflowEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        gitWorkflowEventsByRoom: {
          ...state.gitWorkflowEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-100)
        }
      };
    });
  },
  appendGitHubActionsEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.githubActionsEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.checkedAt === event.checkedAt &&
          existing.owner === event.owner &&
          existing.repo === event.repo &&
          existing.branch === event.branch
        )
      ) {
        return state;
      }
      return {
        githubActionsEventsByRoom: {
          ...state.githubActionsEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-50)
        }
      };
    });
  },
  appendLocalPreviewEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.localPreviewsByRoom[roomId] ?? [];
      const nextEvents = roomEvents.some((existing) => existing.id === event.id)
        ? roomEvents.map((existing) => existing.id === event.id ? event : existing)
        : [...roomEvents, event];
      return {
        localPreviewsByRoom: {
          ...state.localPreviewsByRoom,
          [roomId]: nextEvents.slice(-50)
        }
      };
    });
  },
  appendHostHandoff: (roomId, handoff) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: [...roomHandoffs, handoff]
        }
      };
    });
  },
  markHostHandoffAcceptedForRoom: (roomId, handoffId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (!roomHandoffs.some((handoff) => handoff.id === handoffId)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === handoffId ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  markLatestHostHandoffAcceptedForRoom: (roomId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      const latestAvailable = [...roomHandoffs].reverse().find((handoff) => handoff.status === "available");
      if (!latestAvailable) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === latestAvailable.id ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  setCodexContinuationForRoom: (roomId, handoff) => {
    set((state) => ({
      codexContinuationByRoom: handoff
        ? { ...state.codexContinuationByRoom, [roomId]: handoff }
        : omitRecordKey(state.codexContinuationByRoom, roomId)
    }));
  },
  appendInviteRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.inviteRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        inviteRequestsByRoom: {
          ...state.inviteRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  appendCodexEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.codexEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.turnId === event.turnId &&
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        codexEventsByRoom: {
          ...state.codexEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-80)
        }
      };
    });
  },
  setApprovalVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      approvalVisibleByRoom: visible
        ? { ...state.approvalVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setPendingCodexApprovalForRoom: (roomId, approval) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: approval
        ? { ...state.pendingCodexApprovalsByRoom, [roomId]: approval }
        : omitRecordKey(state.pendingCodexApprovalsByRoom, roomId)
    }));
  },
  resetCodexApprovalForRoom: (roomId) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: omitRecordKey(state.pendingCodexApprovalsByRoom, roomId),
      approvalVisibleByRoom: omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setCodexRunningForRoom: (roomId, running) => {
    set((state) => ({
      codexRunningByRoom: running
        ? { ...state.codexRunningByRoom, [roomId]: true }
        : omitRecordKey(state.codexRunningByRoom, roomId)
    }));
  },
  setCodexThreadIdForRoom: (roomId, threadId) => {
    set((state) => ({
      codexThreadIdsByRoom: threadId
        ? { ...state.codexThreadIdsByRoom, [roomId]: threadId }
        : omitRecordKey(state.codexThreadIdsByRoom, roomId)
    }));
  },
  setFileQueryForRoom: (roomId, query) => {
    set((state) => ({
      fileQueriesByRoom: query
        ? { ...state.fileQueriesByRoom, [roomId]: query }
        : omitRecordKey(state.fileQueriesByRoom, roomId)
    }));
  },
  setProjectFilesForRoom: (roomId, files) => {
    set((state) => ({
      projectFilesByRoom: {
        ...state.projectFilesByRoom,
        [roomId]: files
      }
    }));
  },
  setSelectedFileForRoom: (roomId, file) => {
    set((state) => ({
      selectedFilesByRoom: file
        ? { ...state.selectedFilesByRoom, [roomId]: file }
        : omitRecordKey(state.selectedFilesByRoom, roomId)
    }));
  },
  setSelectedDiffForRoom: (roomId, diff) => {
    set((state) => ({
      selectedDiffsByRoom: diff
        ? { ...state.selectedDiffsByRoom, [roomId]: diff }
        : omitRecordKey(state.selectedDiffsByRoom, roomId)
    }));
  },
  setFilePreviewTabForRoom: (roomId, tab) => {
    set((state) => ({
      filePreviewTabsByRoom: tab === "file"
        ? omitRecordKey(state.filePreviewTabsByRoom, roomId)
        : { ...state.filePreviewTabsByRoom, [roomId]: tab }
    }));
  },
  setFileMessageForRoom: (roomId, message) => {
    set((state) => ({
      fileMessagesByRoom: message
        ? { ...state.fileMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.fileMessagesByRoom, roomId)
    }));
  },
  resetFileContextForRoom: (roomId) => {
    set((state) => ({
      selectedFilesByRoom: omitRecordKey(state.selectedFilesByRoom, roomId),
      selectedDiffsByRoom: omitRecordKey(state.selectedDiffsByRoom, roomId),
      fileQueriesByRoom: omitRecordKey(state.fileQueriesByRoom, roomId),
      projectFilesByRoom: omitRecordKey(state.projectFilesByRoom, roomId),
      fileBusyByRoom: omitRecordKey(state.fileBusyByRoom, roomId),
      fileMessagesByRoom: omitRecordKey(state.fileMessagesByRoom, roomId)
    }));
  },
  setSelectedTerminalIdForRoom: (roomId, terminalId) => {
    set((state) => ({
      selectedTerminalIdsByRoom: terminalId
        ? { ...state.selectedTerminalIdsByRoom, [roomId]: terminalId }
        : omitRecordKey(state.selectedTerminalIdsByRoom, roomId)
    }));
  },
  setTerminalNameForRoom: (roomId, name) => {
    set((state) => ({
      terminalNamesByRoom: name === "dev-server"
        ? omitRecordKey(state.terminalNamesByRoom, roomId)
        : { ...state.terminalNamesByRoom, [roomId]: name }
    }));
  },
  setTerminalCommandForRoom: (roomId, command) => {
    set((state) => ({
      terminalCommandsByRoom: command === "npm run dev:desktop"
        ? omitRecordKey(state.terminalCommandsByRoom, roomId)
        : { ...state.terminalCommandsByRoom, [roomId]: command }
    }));
  },
  setTerminalInputForRoom: (roomId, input) => {
    set((state) => ({
      terminalInputsByRoom: input
        ? { ...state.terminalInputsByRoom, [roomId]: input }
        : omitRecordKey(state.terminalInputsByRoom, roomId)
    }));
  },
  setTerminalErrorForRoom: (roomId, error) => {
    set((state) => ({
      terminalErrorsByRoom: error
        ? { ...state.terminalErrorsByRoom, [roomId]: error }
        : omitRecordKey(state.terminalErrorsByRoom, roomId)
    }));
  },
  appendTerminalLinesForRoom: (roomId, lines, maxTerminalActivityLines) => {
    if (lines.length === 0) return;
    set((state) => {
      const roomLines = state.terminalLinesByRoom[roomId] ?? [];
      return {
        terminalLinesByRoom: {
          ...state.terminalLinesByRoom,
          [roomId]: [...roomLines, ...lines].slice(-maxTerminalActivityLines)
        }
      };
    });
  },
  setHostMessageForRoom: (roomId, message) => {
    set((state) => ({
      hostMessagesByRoom: message
        ? { ...state.hostMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.hostMessagesByRoom, roomId)
    }));
  },
  setChatMessageForRoom: (roomId, message) => {
    set((state) => ({
      chatMessagesByRoom: message
        ? { ...state.chatMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.chatMessagesByRoom, roomId)
    }));
  },
  setMarkdownCopyFallbackForRoom: (roomId, fallback) => {
    set((state) => ({
      markdownCopyFallbacksByRoom: fallback
        ? { ...state.markdownCopyFallbacksByRoom, [roomId]: fallback }
        : omitRecordKey(state.markdownCopyFallbacksByRoom, roomId)
    }));
  },
  setSecretWarningVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      secretWarningsVisibleByRoom: visible
        ? { ...state.secretWarningsVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.secretWarningsVisibleByRoom, roomId)
    }));
  },
  setHistoryMessageForRoom: (roomId, message) => {
    set((state) => ({
      historyMessagesByRoom: message
        ? { ...state.historyMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.historyMessagesByRoom, roomId)
    }));
  },
  setTeamHistoryMessageForTeam: (teamId, message) => {
    const key = teamId || "__no-team";
    set((state) => ({
      teamHistoryMessagesByTeam: message
        ? { ...state.teamHistoryMessagesByTeam, [key]: message }
        : omitRecordKey(state.teamHistoryMessagesByTeam, key)
    }));
  },
  setSettingsMessageForRoom: (roomId, message) => {
    set((state) => ({
      settingsMessagesByRoom: message
        ? { ...state.settingsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.settingsMessagesByRoom, roomId)
    }));
  },
  setGitWorkflowMessageForRoom: (roomId, message) => {
    set((state) => ({
      gitWorkflowMessagesByRoom: {
        ...state.gitWorkflowMessagesByRoom,
        [roomId]: message
      }
    }));
  },
  setGitStatusForRoom: (roomId, status) => {
    set((state) => ({
      gitStatusByRoom: {
        ...state.gitStatusByRoom,
        [roomId]: status
      }
    }));
  },
  updateGitWorkflowDraftForRoom: (roomId, patch) => {
    set((state) => ({
      gitWorkflowDraftsByRoom: updateGitWorkflowDraftRecord(state.gitWorkflowDraftsByRoom, roomId, patch)
    }));
  },
  setBrowserUrlForRoom: (roomId, url, defaultBrowserUrl) => {
    set((state) => ({
      browserUrlsByRoom: url === defaultBrowserUrl
        ? omitRecordKey(state.browserUrlsByRoom, roomId)
        : { ...state.browserUrlsByRoom, [roomId]: url }
    }));
  },
  setBrowserReasonForRoom: (roomId, reason, defaultBrowserReason) => {
    set((state) => ({
      browserReasonsByRoom: reason === defaultBrowserReason
        ? omitRecordKey(state.browserReasonsByRoom, roomId)
        : { ...state.browserReasonsByRoom, [roomId]: reason }
    }));
  },
  setBrowserMessageForRoom: (roomId, message) => {
    set((state) => ({
      browserMessagesByRoom: message
        ? { ...state.browserMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.browserMessagesByRoom, roomId)
    }));
  },
  setInviteLinkForRoom: (roomId, link) => {
    set((state) => ({
      inviteLinksByRoom: link
        ? { ...state.inviteLinksByRoom, [roomId]: link }
        : omitRecordKey(state.inviteLinksByRoom, roomId)
    }));
  },
  setInviteApprovalGateForRoom: (roomId, enabled) => {
    set((state) => ({
      inviteApprovalGatesByRoom: enabled
        ? { ...state.inviteApprovalGatesByRoom, [roomId]: true }
        : omitRecordKey(state.inviteApprovalGatesByRoom, roomId)
    }));
  },
  setInviteMessageForRoom: (roomId, message) => {
    set((state) => ({
      inviteMessagesByRoom: message
        ? { ...state.inviteMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.inviteMessagesByRoom, roomId)
    }));
  },
  setCustomCodexModelForRoom: (roomId, model, currentModel) => {
    set((state) => ({
      customCodexModelsByRoom: model === currentModel
        ? omitRecordKey(state.customCodexModelsByRoom, roomId)
        : { ...state.customCodexModelsByRoom, [roomId]: model }
    }));
  },
  setProjectPathDraftForRoom: (roomId, projectPath, currentProjectPath) => {
    set((state) => ({
      projectPathDraftsByRoom: projectPath === currentProjectPath
        ? omitRecordKey(state.projectPathDraftsByRoom, roomId)
        : { ...state.projectPathDraftsByRoom, [roomId]: projectPath }
    }));
  },
  setPendingAttachmentsForRoom: (roomId, updater) => {
    set((state) => {
      const currentAttachments = state.pendingAttachmentsByRoom[roomId] ?? [];
      const nextAttachments = typeof updater === "function" ? updater(currentAttachments) : updater;
      return {
        pendingAttachmentsByRoom: {
          ...state.pendingAttachmentsByRoom,
          [roomId]: nextAttachments
        }
      };
    });
  },
  setDraftForRoom: (roomId, value) => {
    set((state) => ({
      draftsByRoom: {
        ...state.draftsByRoom,
        [roomId]: value
      }
    }));
  },
  clearRoomScopedStateForRoom: (roomId) => {
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [] },
      terminalRequestsByRoom: { ...state.terminalRequestsByRoom, [roomId]: [] },
      browserRequestsByRoom: { ...state.browserRequestsByRoom, [roomId]: [] },
      inviteRequestsByRoom: { ...state.inviteRequestsByRoom, [roomId]: [] },
      codexEventsByRoom: { ...state.codexEventsByRoom, [roomId]: [] },
      gitWorkflowEventsByRoom: { ...state.gitWorkflowEventsByRoom, [roomId]: [] },
      githubActionsEventsByRoom: { ...state.githubActionsEventsByRoom, [roomId]: [] },
      hostHandoffsByRoom: { ...state.hostHandoffsByRoom, [roomId]: [] },
      codexThreadIdsByRoom: omitRecordKey(state.codexThreadIdsByRoom, roomId),
      actionRunsByRoom: omitRecordKey(state.actionRunsByRoom, roomId),
      actionsLastCheckedByRoom: omitRecordKey(state.actionsLastCheckedByRoom, roomId),
      actionsMessagesByRoom: omitRecordKey(state.actionsMessagesByRoom, roomId),
      actionsBusyByRoom: omitRecordKey(state.actionsBusyByRoom, roomId),
      gitWorkflowBusyByRoom: omitRecordKey(state.gitWorkflowBusyByRoom, roomId),
      hostBusyByRoom: omitRecordKey(state.hostBusyByRoom, roomId),
      hostMessagesByRoom: omitRecordKey(state.hostMessagesByRoom, roomId),
      chatMessagesByRoom: omitRecordKey(state.chatMessagesByRoom, roomId),
      markdownCopyFallbacksByRoom: omitRecordKey(state.markdownCopyFallbacksByRoom, roomId),
      secretWarningsVisibleByRoom: omitRecordKey(state.secretWarningsVisibleByRoom, roomId),
      historyMessagesByRoom: omitRecordKey(state.historyMessagesByRoom, roomId),
      settingsBusyByRoom: omitRecordKey(state.settingsBusyByRoom, roomId),
      settingsMessagesByRoom: omitRecordKey(state.settingsMessagesByRoom, roomId),
      customCodexModelsByRoom: omitRecordKey(state.customCodexModelsByRoom, roomId),
      projectPathDraftsByRoom: omitRecordKey(state.projectPathDraftsByRoom, roomId),
      keyRotationBusyByRoom: omitRecordKey(state.keyRotationBusyByRoom, roomId),
      approvalVisibleByRoom: omitRecordKey(state.approvalVisibleByRoom, roomId),
      pendingCodexApprovalsByRoom: omitRecordKey(state.pendingCodexApprovalsByRoom, roomId),
      codexRunningByRoom: omitRecordKey(state.codexRunningByRoom, roomId),
      browserStatusByRoom: omitRecordKey(state.browserStatusByRoom, roomId),
      activeBrowserUrlsByRoom: omitRecordKey(state.activeBrowserUrlsByRoom, roomId),
      gitStatusByRoom: omitRecordKey(state.gitStatusByRoom, roomId),
      fileQueriesByRoom: omitRecordKey(state.fileQueriesByRoom, roomId),
      projectFilesByRoom: omitRecordKey(state.projectFilesByRoom, roomId),
      selectedFilesByRoom: omitRecordKey(state.selectedFilesByRoom, roomId),
      selectedDiffsByRoom: omitRecordKey(state.selectedDiffsByRoom, roomId),
      fileBusyByRoom: omitRecordKey(state.fileBusyByRoom, roomId),
      fileMessagesByRoom: omitRecordKey(state.fileMessagesByRoom, roomId),
      pendingAttachmentsByRoom: omitRecordKey(state.pendingAttachmentsByRoom, roomId),
      terminalLinesByRoom: omitRecordKey(state.terminalLinesByRoom, roomId),
      terminalBusyByRoom: omitRecordKey(state.terminalBusyByRoom, roomId),
      selectedTerminalIdsByRoom: omitRecordKey(state.selectedTerminalIdsByRoom, roomId),
      terminalNamesByRoom: omitRecordKey(state.terminalNamesByRoom, roomId),
      terminalCommandsByRoom: omitRecordKey(state.terminalCommandsByRoom, roomId),
      terminalInputsByRoom: omitRecordKey(state.terminalInputsByRoom, roomId),
      terminalErrorsByRoom: omitRecordKey(state.terminalErrorsByRoom, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId),
      browserUrlsByRoom: omitRecordKey(state.browserUrlsByRoom, roomId),
      browserReasonsByRoom: omitRecordKey(state.browserReasonsByRoom, roomId),
      browserMessagesByRoom: omitRecordKey(state.browserMessagesByRoom, roomId),
      inviteLinksByRoom: omitRecordKey(state.inviteLinksByRoom, roomId),
      inviteApprovalGatesByRoom: omitRecordKey(state.inviteApprovalGatesByRoom, roomId),
      inviteMessagesByRoom: omitRecordKey(state.inviteMessagesByRoom, roomId),
      draftsByRoom: omitRecordKey(state.draftsByRoom, roomId)
    }));
  },
  resetAppStore: () => set(emptyAppStoreState),
  resetGitWorkflowState: () => set(emptyAppStoreState)
}));

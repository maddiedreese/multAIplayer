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
  setPendingAttachmentsForRoom: (
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) => void;
  setDraftForRoom: (roomId: string, value: string) => void;
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
  resetAppStore: () => set(emptyAppStoreState),
  resetGitWorkflowState: () => set(emptyAppStoreState)
}));

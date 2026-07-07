import { create } from "zustand";
import type { SetStateAction } from "react";
import type { GitHubActionRun } from "../lib/authClient";
import type { GitDiffResult, GitStatusSummary, ProjectFileContent, ProjectFileEntry } from "../lib/localBackend";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import type {
  BrowserAccessRequest,
  BrowserStatus,
  ChatAttachment,
  CodexRoomEvent,
  InviteJoinRequest,
  LocalPreviewDialogState,
  LocalPreviewRecord,
  PendingCodexApproval
} from "../types";
import type { FilePreviewTab } from "../lib/filePreview";
import type { MarkdownCopyFallback } from "../types";

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
  selectedMessageIdsByRoom: {}
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
  resetAppStore: () => set(emptyAppStoreState),
  resetGitWorkflowState: () => set(emptyAppStoreState)
}));

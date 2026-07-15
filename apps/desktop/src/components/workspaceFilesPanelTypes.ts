import type { FilePreviewTab } from "../lib/filePreview";
import type { GitDiffResult, GitStatusSummary, ProjectFileContent, ProjectFileEntry } from "../lib/localBackend";
import type { WorkspaceFileSaveRequest } from "../types";

export interface WorkspaceFilesPanelProps {
  fileQuery: string;
  projectFiles: ProjectFileEntry[];
  selectedFile: ProjectFileContent | null;
  gitStatus: GitStatusSummary | null;
  selectedDiff: GitDiffResult | null;
  fileBusy: boolean;
  fileMessage: string | null;
  fileSaveRequests: WorkspaceFileSaveRequest[];
  canReadLocalWorkspace: boolean;
  isActiveHost: boolean;
  canAttachSelectedFile: boolean;
  selectedFileRisks: string[];
  selectedFileNeedsAttachmentReview: boolean;
  selectedSensitiveFileReviewed: boolean;
  selectedAttachmentActionLabel: string;
  selectedAttachmentWarningDetail?: string;
  filePreviewTab: FilePreviewTab;
  formatBytes: (bytes: number) => string;
  onCopyProjectMarkdown: () => void;
  onFileQueryChange: (query: string) => void;
  onOpenProjectFile: (path: string, tab: FilePreviewTab) => void;
  onCopyDiffSummaryMarkdown: () => void;
  onAttachSelectedFileToMessage: () => void;
  onSaveSelectedFileContent: (content: string) => void;
  onApproveFileSaveRequest: (request: WorkspaceFileSaveRequest) => void;
  onDenyFileSaveRequest: (requestId: string) => void;
  onFilePreviewTabChange: (tab: FilePreviewTab) => void;
  onCloseFileViewer: () => void;
}

export type WorkspaceFileOpenAction = WorkspaceFilesPanelProps["onOpenProjectFile"];

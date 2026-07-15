import { useEffect, useState } from "react";
import { WorkspaceFileLists } from "./WorkspaceFileLists";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import type { WorkspaceFilesPanelProps } from "./workspaceFilesPanelTypes";

export function WorkspaceFilesPanel(props: WorkspaceFilesPanelProps) {
  const [editorContent, setEditorContent] = useState(props.selectedFile?.content ?? "");
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const selectedFileKey = props.selectedFile
    ? `${props.selectedFile.path}:${props.selectedFile.size}:${props.selectedFile.content}`
    : "";
  useEffect(() => {
    setEditorContent(props.selectedFile?.content ?? "");
  }, [selectedFileKey, props.selectedFile]);

  const viewerPath = props.selectedFile?.path ?? props.selectedDiff?.path ?? null;
  if (!viewerPath) {
    return (
      <WorkspaceFileLists
        model={{
          query: props.fileQuery,
          projectFiles: props.projectFiles,
          gitStatus: props.gitStatus,
          busy: props.fileBusy,
          message: props.fileMessage
        }}
        canReadWorkspace={props.canReadLocalWorkspace}
        actions={{
          copyProjectMarkdown: props.onCopyProjectMarkdown,
          changeQuery: props.onFileQueryChange,
          openFile: props.onOpenProjectFile,
          copyDiffSummaryMarkdown: props.onCopyDiffSummaryMarkdown
        }}
        formatBytes={props.formatBytes}
      />
    );
  }

  return (
    <WorkspaceFileViewer
      model={{
        query: props.fileQuery,
        projectFiles: props.projectFiles,
        selectedFile: props.selectedFile,
        gitStatus: props.gitStatus,
        selectedDiff: props.selectedDiff,
        busy: props.fileBusy,
        message: props.fileMessage,
        pendingSaveRequests: props.fileSaveRequests.filter((request) => request.status === "pending"),
        path: viewerPath,
        previewTab: props.filePreviewTab
      }}
      access={{
        canReadWorkspace: props.canReadLocalWorkspace,
        isActiveHost: props.isActiveHost,
        canAttachSelectedFile: props.canAttachSelectedFile
      }}
      attachmentReview={{
        risks: props.selectedFileRisks,
        needsReview: props.selectedFileNeedsAttachmentReview,
        sensitiveFileReviewed: props.selectedSensitiveFileReviewed,
        actionLabel: props.selectedAttachmentActionLabel,
        ...(props.selectedAttachmentWarningDetail === undefined
          ? {}
          : { warningDetail: props.selectedAttachmentWarningDetail })
      }}
      editor={{
        content: editorContent,
        dirty: Boolean(props.selectedFile && editorContent !== props.selectedFile.content),
        expanded: viewerExpanded
      }}
      actions={{
        close: props.onCloseFileViewer,
        toggleExpanded: () => setViewerExpanded((current) => !current),
        changeQuery: props.onFileQueryChange,
        openFile: props.onOpenProjectFile,
        attachSelectedFile: props.onAttachSelectedFileToMessage,
        changeEditorContent: setEditorContent,
        saveSelectedFile: props.onSaveSelectedFileContent,
        approveSaveRequest: props.onApproveFileSaveRequest,
        denySaveRequest: props.onDenyFileSaveRequest,
        changePreviewTab: props.onFilePreviewTabChange
      }}
      formatBytes={props.formatBytes}
    />
  );
}

import { Maximize2, Minimize2, Plus, RotateCcw, Save, Search, ShieldAlert, X } from "lucide-react";
import type { FilePreviewTab } from "../lib/files/filePreview";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  ProjectFileEntry
} from "../lib/platform/localBackend";
import type { WorkspaceFileSaveRequest } from "../types";
import { FilePreviewTabs } from "./FilePreviewTabs";
import { InlineSecretWarning } from "./common";
import { MonacoFileEditor } from "./MonacoFileEditor";
import type { WorkspaceFileOpenAction } from "./workspaceFilesPanelTypes";

export interface WorkspaceFileViewerModel {
  query: string;
  projectFiles: ProjectFileEntry[];
  selectedFile: ProjectFileContent | null;
  gitStatus: GitStatusSummary | null;
  selectedDiff: GitDiffResult | null;
  busy: boolean;
  message: string | null;
  pendingSaveRequests: WorkspaceFileSaveRequest[];
  path: string;
  previewTab: FilePreviewTab;
}

export interface WorkspaceFileViewerAccess {
  canReadWorkspace: boolean;
  isActiveHost: boolean;
  canAttachSelectedFile: boolean;
}

export interface WorkspaceFileAttachmentReview {
  risks: string[];
  needsReview: boolean;
  sensitiveFileReviewed: boolean;
  actionLabel: string;
  warningDetail?: string;
}

export interface WorkspaceFileEditorState {
  content: string;
  dirty: boolean;
  expanded: boolean;
}

export interface WorkspaceFileViewerActions {
  close: () => void;
  toggleExpanded: () => void;
  changeQuery: (query: string) => void;
  openFile: WorkspaceFileOpenAction;
  attachSelectedFile: () => void;
  changeEditorContent: (content: string) => void;
  saveSelectedFile: (content: string) => void;
  approveSaveRequest: (request: WorkspaceFileSaveRequest) => void;
  denySaveRequest: (requestId: string) => void;
  changePreviewTab: (tab: FilePreviewTab) => void;
}

export function WorkspaceFileViewer({
  model,
  access,
  attachmentReview,
  editor,
  actions,
  formatBytes
}: {
  model: WorkspaceFileViewerModel;
  access: WorkspaceFileViewerAccess;
  attachmentReview: WorkspaceFileAttachmentReview;
  editor: WorkspaceFileEditorState;
  actions: WorkspaceFileViewerActions;
  formatBytes: (bytes: number) => string;
}) {
  const selectedFileName = model.path.split("/").at(-1) ?? model.path;
  const saveButtonLabel = access.isActiveHost ? "Save" : "Request save";
  return (
    <section className={`panel file-viewer-open ${editor.expanded ? "expanded" : ""}`}>
      <FileViewerToolbar
        selectedFileName={selectedFileName}
        model={model}
        access={access}
        attachmentReview={attachmentReview}
        editor={editor}
        actions={actions}
      />

      <label className="file-search viewer-search">
        <Search size={14} />
        <input
          value={model.query}
          onChange={(event) => actions.changeQuery(event.target.value)}
          placeholder="Search files in this project"
          disabled={!access.canReadWorkspace}
        />
      </label>

      <div className="file-viewer-switcher">
        <label>
          <span>File</span>
          <select
            value={model.projectFiles.some((file) => file.path === model.path) ? model.path : ""}
            onChange={(event) => openSelectedFile(event.target.value, "file", actions.openFile)}
            disabled={!access.canReadWorkspace || model.projectFiles.length === 0}
          >
            <option value="">Choose file</option>
            {model.projectFiles.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path} · {formatBytes(file.size)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Diff</span>
          <select
            value={selectedDiffPath(model)}
            onChange={(event) => openSelectedFile(event.target.value, "diff", actions.openFile)}
            disabled={!access.canReadWorkspace || !model.gitStatus?.files.length}
          >
            <option value="">Choose diff</option>
            {(model.gitStatus?.files ?? []).map((file) => (
              <option key={file.path} value={file.path}>
                {file.path} · +{file.added} -{file.removed}
              </option>
            ))}
          </select>
        </label>
      </div>

      {attachmentReview.risks.length > 0 && (
        <InlineSecretWarning risks={attachmentReview.risks} detail={attachmentReview.warningDetail} />
      )}
      <div className="file-viewer-meta">
        <FilePreviewTabs
          activeTab={model.previewTab}
          hasDiff={Boolean(model.selectedDiff?.diff.trim())}
          onSelectTab={actions.changePreviewTab}
        />
        <FileEditorActions
          model={model}
          editor={editor}
          access={access}
          actions={actions}
          formatBytes={formatBytes}
          saveButtonLabel={saveButtonLabel}
        />
      </div>
      <FileViewerBody model={model} editor={editor} access={access} onChange={actions.changeEditorContent} />
      <PendingFileSaveRequests
        requests={model.pendingSaveRequests}
        isActiveHost={access.isActiveHost}
        onApprove={actions.approveSaveRequest}
        onDeny={actions.denySaveRequest}
      />
      {model.message && <div className="workflow-message">{model.message}</div>}
    </section>
  );
}

function FileViewerToolbar({
  selectedFileName,
  model,
  access,
  attachmentReview,
  editor,
  actions
}: {
  selectedFileName: string;
  model: WorkspaceFileViewerModel;
  access: WorkspaceFileViewerAccess;
  attachmentReview: WorkspaceFileAttachmentReview;
  editor: WorkspaceFileEditorState;
  actions: WorkspaceFileViewerActions;
}) {
  const sensitiveReviewPending = attachmentReview.needsReview && !attachmentReview.sensitiveFileReviewed;
  return (
    <div className="file-viewer-toolbar">
      <button className="ghost icon-only" onClick={actions.close} aria-label="Close file editor">
        <X size={15} />
      </button>
      <div>
        <strong>{selectedFileName}</strong>
        <span>{model.path}</span>
      </div>
      <div className="file-viewer-toolbar-actions">
        <button
          className={attachmentReview.needsReview && attachmentReview.sensitiveFileReviewed ? "ghost danger" : "ghost"}
          onClick={actions.attachSelectedFile}
          disabled={!model.selectedFile || !access.canReadWorkspace || !access.canAttachSelectedFile}
        >
          {sensitiveReviewPending ? <ShieldAlert size={14} /> : <Plus size={14} />}
          {attachmentReview.actionLabel}
        </button>
        <button
          className="ghost icon-only"
          onClick={actions.toggleExpanded}
          aria-label={editor.expanded ? "Return file editor to column" : "Expand file editor"}
          title={editor.expanded ? "Return to column" : "Expand"}
        >
          {editor.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}

function FileEditorActions({
  model,
  editor,
  access,
  actions,
  formatBytes,
  saveButtonLabel
}: {
  model: WorkspaceFileViewerModel;
  editor: WorkspaceFileEditorState;
  access: WorkspaceFileViewerAccess;
  actions: WorkspaceFileViewerActions;
  formatBytes: (bytes: number) => string;
  saveButtonLabel: string;
}) {
  const selectedFile = model.selectedFile;
  return (
    <div className="file-editor-actions">
      <small className={selectedFile?.truncated ? "panel-state attention" : "panel-state"}>
        {fileEditorStatus(selectedFile, editor.dirty, formatBytes)}
      </small>
      <button
        className="ghost"
        onClick={() => actions.changeEditorContent(selectedFile?.content ?? "")}
        disabled={!selectedFile || !editor.dirty || model.busy}
      >
        <RotateCcw size={14} />
        Revert
      </button>
      <button
        className="primary"
        onClick={() => actions.saveSelectedFile(editor.content)}
        disabled={!selectedFile || !editor.dirty || model.busy || selectedFile.truncated || !access.canReadWorkspace}
        title={access.isActiveHost ? "Save file" : "Request active host approval to save this file"}
      >
        <Save size={14} />
        {saveButtonLabel}
      </button>
    </div>
  );
}

function FileViewerBody({
  model,
  editor,
  access,
  onChange
}: {
  model: WorkspaceFileViewerModel;
  editor: WorkspaceFileEditorState;
  access: WorkspaceFileViewerAccess;
  onChange: (content: string) => void;
}) {
  if (model.previewTab === "diff" && model.selectedDiff?.diff.trim()) {
    return (
      <div className="file-viewer-body">
        <div className="diff-code" aria-label={`Diff for ${model.selectedDiff.path}`}>
          {parseDiffLines(model.selectedDiff.diff).map((line, index) => (
            <div className={`diff-code-line ${line.kind}`} key={`${index}-${line.text}`}>
              <span>{line.prefix || " "}</span>
              <code>{line.text}</code>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="file-viewer-body">
      {model.selectedFile ? (
        <MonacoFileEditor
          path={model.selectedFile.path}
          value={editor.content}
          onChange={onChange}
          disabled={!access.canReadWorkspace || model.selectedFile.truncated}
        />
      ) : (
        <div className="empty-state compact">No current file content is available for this diff.</div>
      )}
    </div>
  );
}

function PendingFileSaveRequests({
  requests,
  isActiveHost,
  onApprove,
  onDeny
}: {
  requests: WorkspaceFileSaveRequest[];
  isActiveHost: boolean;
  onApprove: (request: WorkspaceFileSaveRequest) => void;
  onDeny: (requestId: string) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="file-save-requests">
      {requests.map((request) => (
        <div className="file-save-request" key={request.id}>
          <div>
            <strong>{request.path}</strong>
            <span>{request.requester} requested a save</span>
          </div>
          <small>{formatLineDelta(request.previousContent, request.nextContent)}</small>
          <details className="file-save-request-preview">
            <summary>Review content</summary>
            <pre>{formatRequestedContentPreview(request.nextContent)}</pre>
          </details>
          {isActiveHost && (
            <div>
              <button className="primary" onClick={() => onApprove(request)}>
                Approve
              </button>
              <button className="ghost" onClick={() => onDeny(request.id)}>
                Deny
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function selectedDiffPath(model: WorkspaceFileViewerModel) {
  return model.gitStatus?.files.some((file) => file.path === model.path) && model.previewTab === "diff"
    ? model.path
    : "";
}

function openSelectedFile(path: string, tab: FilePreviewTab, openFile: WorkspaceFileOpenAction) {
  if (path) openFile(path, tab);
}

function fileEditorStatus(
  selectedFile: ProjectFileContent | null,
  editorDirty: boolean,
  formatBytes: (bytes: number) => string
) {
  if (!selectedFile) return "Diff only";
  if (selectedFile.truncated) return "Truncated";
  return `${formatBytes(selectedFile.size)}${editorDirty ? " · unsaved" : ""}`;
}

function formatLineDelta(previousContent: string, nextContent: string): string {
  const previousLines = previousContent.split("\n");
  const nextLines = nextContent.split("\n");
  const added = Math.max(0, nextLines.length - previousLines.length);
  const removed = Math.max(0, previousLines.length - nextLines.length);
  if (added === 0 && removed === 0) return `${nextLines.length} line(s) edited`;
  return `+${added} -${removed} line(s)`;
}

function formatRequestedContentPreview(content: string): string {
  const maxPreviewChars = 6000;
  if (content.length <= maxPreviewChars) return content || "(empty file)";
  return `${content.slice(0, maxPreviewChars)}\n\n... ${content.length - maxPreviewChars} more character(s)`;
}

function parseDiffLines(
  diff: string
): Array<{ kind: "added" | "removed" | "hunk" | "meta" | "context"; prefix: string; text: string }> {
  return diff.split("\n").map((line) => {
    if (line.startsWith("@@")) return { kind: "hunk", prefix: "", text: line };
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ")
    ) {
      return { kind: "meta", prefix: "", text: line };
    }
    if (line.startsWith("+")) return { kind: "added", prefix: "+", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "removed", prefix: "-", text: line.slice(1) };
    return {
      kind: "context",
      prefix: line.startsWith(" ") ? " " : "",
      text: line.startsWith(" ") ? line.slice(1) : line
    };
  });
}

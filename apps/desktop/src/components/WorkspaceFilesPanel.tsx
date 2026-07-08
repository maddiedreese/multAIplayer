import { useEffect, useState } from "react";
import { Copy, FileCode2, Plus, RotateCcw, Save, Search, ShieldAlert, X } from "lucide-react";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  ProjectFileEntry
} from "../lib/localBackend";
import type { FilePreviewTab } from "../lib/filePreview";
import { FilePreviewTabs } from "./FilePreviewTabs";
import { InlineSecretWarning } from "./common";

export function WorkspaceFilesPanel({
  fileQuery,
  projectFiles,
  selectedFile,
  gitStatus,
  selectedDiff,
  fileBusy,
  fileMessage,
  canReadLocalWorkspace,
  canAttachSelectedFile,
  selectedFileRisks,
  selectedFileNeedsAttachmentReview,
  selectedSensitiveFileReviewed,
  selectedAttachmentActionLabel,
  selectedAttachmentWarningDetail,
  filePreviewTab,
  formatBytes,
  onCopyProjectMarkdown,
  onFileQueryChange,
  onOpenProjectFile,
  onCopyDiffSummaryMarkdown,
  onAttachSelectedFileToMessage,
  onSaveSelectedFileContent,
  onFilePreviewTabChange,
  onCloseFileViewer
}: {
  fileQuery: string;
  projectFiles: ProjectFileEntry[];
  selectedFile: ProjectFileContent | null;
  gitStatus: GitStatusSummary | null;
  selectedDiff: GitDiffResult | null;
  fileBusy: boolean;
  fileMessage: string | null;
  canReadLocalWorkspace: boolean;
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
  onFilePreviewTabChange: (tab: FilePreviewTab) => void;
  onCloseFileViewer: () => void;
}) {
  const [editorContent, setEditorContent] = useState(selectedFile?.content ?? "");
  const selectedFileKey = selectedFile ? `${selectedFile.path}:${selectedFile.size}:${selectedFile.content}` : "";
  useEffect(() => {
    setEditorContent(selectedFile?.content ?? "");
  }, [selectedFileKey, selectedFile]);
  const editorDirty = Boolean(selectedFile && editorContent !== selectedFile.content);
  const viewerPath = selectedFile?.path ?? selectedDiff?.path ?? null;
  if (viewerPath) {
    const selectedFileName = viewerPath.split("/").at(-1) ?? viewerPath;
    return (
      <section className="panel file-viewer-open">
        <div className="file-viewer-toolbar">
          <button className="ghost icon-only" onClick={onCloseFileViewer} aria-label="Close file viewer">
            <X size={15} />
          </button>
          <div>
            <strong>{selectedFileName}</strong>
            <span>{viewerPath}</span>
          </div>
          <button
            className={selectedFileNeedsAttachmentReview && selectedSensitiveFileReviewed ? "ghost danger" : "ghost"}
            onClick={onAttachSelectedFileToMessage}
            disabled={!selectedFile || !canReadLocalWorkspace || !canAttachSelectedFile}
          >
            {selectedFileNeedsAttachmentReview && !selectedSensitiveFileReviewed ? <ShieldAlert size={14} /> : <Plus size={14} />}
            {selectedAttachmentActionLabel}
          </button>
        </div>

        <label className="file-search viewer-search">
          <Search size={14} />
          <input
            value={fileQuery}
            onChange={(event) => onFileQueryChange(event.target.value)}
            placeholder="Search files in this project"
            disabled={!canReadLocalWorkspace}
          />
        </label>

        <div className="file-viewer-switcher">
          <label>
            <span>File</span>
            <select
              value={projectFiles.some((file) => file.path === viewerPath) ? viewerPath : ""}
              onChange={(event) => {
                if (event.target.value) onOpenProjectFile(event.target.value, "file");
              }}
              disabled={!canReadLocalWorkspace || projectFiles.length === 0}
            >
              <option value="">Choose file</option>
              {projectFiles.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path} · {formatBytes(file.size)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Diff</span>
            <select
              value={gitStatus?.files.some((file) => file.path === viewerPath) && filePreviewTab === "diff" ? viewerPath : ""}
              onChange={(event) => {
                if (event.target.value) onOpenProjectFile(event.target.value, "diff");
              }}
              disabled={!canReadLocalWorkspace || !gitStatus?.files.length}
            >
              <option value="">Choose diff</option>
              {(gitStatus?.files ?? []).map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path} · +{file.added} -{file.removed}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedFileRisks.length > 0 && (
          <InlineSecretWarning
            risks={selectedFileRisks}
            detail={selectedAttachmentWarningDetail}
          />
        )}
        <div className="file-viewer-meta">
          <FilePreviewTabs
            activeTab={filePreviewTab}
            hasDiff={Boolean(selectedDiff?.diff.trim())}
            onSelectTab={onFilePreviewTabChange}
          />
          <div className="file-editor-actions">
            <small className={selectedFile?.truncated ? "panel-state attention" : "panel-state"}>
              {selectedFile
                ? selectedFile.truncated
                  ? "Truncated"
                  : `${formatBytes(selectedFile.size)}${editorDirty ? " · unsaved" : ""}`
                : "Diff only"}
            </small>
            <button
              className="ghost"
              onClick={() => setEditorContent(selectedFile?.content ?? "")}
              disabled={!selectedFile || !editorDirty || fileBusy}
            >
              <RotateCcw size={14} />
              Revert
            </button>
            <button
              className="primary"
              onClick={() => onSaveSelectedFileContent(editorContent)}
              disabled={!selectedFile || !editorDirty || fileBusy || selectedFile.truncated || !canReadLocalWorkspace}
            >
              <Save size={14} />
              Save
            </button>
          </div>
        </div>
        <div className="file-viewer-body">
          {filePreviewTab === "diff" && selectedDiff?.diff.trim() ? (
            <div className="diff-code" aria-label={`Diff for ${selectedDiff.path}`}>
              {parseDiffLines(selectedDiff.diff).map((line, index) => (
                <div className={`diff-code-line ${line.kind}`} key={`${index}-${line.text}`}>
                  <span>{line.prefix || " "}</span>
                  <code>{line.text}</code>
                </div>
              ))}
            </div>
          ) : (
            selectedFile ? (
              <textarea
                className="file-editor"
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                spellCheck={false}
                disabled={!canReadLocalWorkspace || selectedFile.truncated}
                aria-label={`Edit ${selectedFile.path}`}
              />
            ) : (
              <div className="empty-state compact">No current file content is available for this diff.</div>
            )
          )}
        </div>
        {fileMessage && <div className="workflow-message">{fileMessage}</div>}
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <span>Files</span>
          <button className="ghost" onClick={onCopyProjectMarkdown} disabled={!canReadLocalWorkspace}>
            <Copy size={14} /> Markdown
          </button>
        </div>
        <label className="file-search">
          <Search size={14} />
          <input
            value={fileQuery}
            onChange={(event) => onFileQueryChange(event.target.value)}
            placeholder="Search project files"
            disabled={!canReadLocalWorkspace}
          />
        </label>
        <div className="file-list">
          {projectFiles.map((file) => (
            <button
              className="file-row"
              key={file.path}
              onClick={() => onOpenProjectFile(file.path, "file")}
              disabled={!canReadLocalWorkspace}
            >
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <small>{formatBytes(file.size)}</small>
            </button>
          ))}
          {!fileBusy && projectFiles.length === 0 && (
            <div className="empty-state">No files match this search.</div>
          )}
        </div>
        {fileBusy && projectFiles.length === 0 && <div className="empty-state">Loading project files...</div>}
        {fileMessage && <div className="workflow-message">{fileMessage}</div>}
      </section>

      <section className="panel">
        <div className="panel-title">
          <span>Changed files</span>
          <div className="panel-title-actions">
            <button className="ghost" onClick={onCopyDiffSummaryMarkdown} disabled={!canReadLocalWorkspace}>
              <Copy size={14} /> Summary
            </button>
            <small className="panel-count">{gitStatus?.files.length ?? 0}</small>
          </div>
        </div>
        <div className="diff-list">
          {(gitStatus?.files.length ? gitStatus.files : []).map((file) => (
            <button className="diff-row" key={file.path} onClick={() => onOpenProjectFile(file.path, "diff")} disabled={!canReadLocalWorkspace}>
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <small><b>+{file.added}</b> <i>-{file.removed}</i></small>
            </button>
          ))}
          {gitStatus?.files.length === 0 && (
            <div className="empty-state">No local file changes in this project.</div>
          )}
        </div>
      </section>
    </>
  );
}

function parseDiffLines(diff: string): Array<{ kind: "added" | "removed" | "hunk" | "meta" | "context"; prefix: string; text: string }> {
  return diff.split("\n").map((line) => {
    if (line.startsWith("@@")) return { kind: "hunk", prefix: "", text: line };
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
      return { kind: "meta", prefix: "", text: line };
    }
    if (line.startsWith("+")) return { kind: "added", prefix: "+", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "removed", prefix: "-", text: line.slice(1) };
    return { kind: "context", prefix: line.startsWith(" ") ? " " : "", text: line.startsWith(" ") ? line.slice(1) : line };
  });
}

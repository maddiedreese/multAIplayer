import { Copy, FileCode2, Plus, Search, ShieldAlert } from "lucide-react";
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
  onFilePreviewTabChange
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
  onFilePreviewTabChange: (tab: FilePreviewTab) => void;
}) {
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
              className={selectedFile?.path === file.path ? "file-row active" : "file-row"}
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
        {fileBusy && <div className="empty-state">Loading project files...</div>}
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

      <section className="panel diff-preview">
        <div className="panel-title">
          <span>{selectedFile ? selectedFile.path.split("/").at(-1) : "File preview"}</span>
          <div className="panel-title-actions">
            {selectedFile && (
              <button
                className={selectedFileNeedsAttachmentReview && selectedSensitiveFileReviewed ? "ghost danger" : "ghost"}
                onClick={onAttachSelectedFileToMessage}
                disabled={!canReadLocalWorkspace || !canAttachSelectedFile}
              >
                {selectedFileNeedsAttachmentReview && !selectedSensitiveFileReviewed ? <ShieldAlert size={14} /> : <Plus size={14} />}
                {selectedAttachmentActionLabel}
              </button>
            )}
            <small className={selectedFile?.truncated ? "panel-state attention" : "panel-state"}>
              {selectedFile?.truncated ? "Truncated" : selectedFile ? formatBytes(selectedFile.size) : "No file selected"}
            </small>
          </div>
        </div>
        {selectedFileRisks.length > 0 && (
          <InlineSecretWarning
            risks={selectedFileRisks}
            detail={selectedAttachmentWarningDetail}
          />
        )}
        {selectedFile && (
          <FilePreviewTabs
            activeTab={filePreviewTab}
            hasDiff={Boolean(selectedDiff?.diff.trim())}
            onSelectTab={onFilePreviewTabChange}
          />
        )}
        {!selectedFile ? (
          <div className="empty-state preview-empty">Select a file or changed path to preview it here.</div>
        ) : filePreviewTab === "diff" && selectedDiff?.diff.trim() ? (
          <div className="diff-code" aria-label={`Diff for ${selectedDiff.path}`}>
            {parseDiffLines(selectedDiff.diff).map((line, index) => (
              <div className={`diff-code-line ${line.kind}`} key={`${index}-${line.text}`}>
                <span>{line.prefix || " "}</span>
                <code>{line.text}</code>
              </div>
            ))}
          </div>
        ) : (
          <pre>
            <code>
{selectedFile.content}
            </code>
          </pre>
        )}
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

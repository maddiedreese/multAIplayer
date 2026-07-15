import { Copy, FileCode2, Search } from "lucide-react";
import type { GitStatusSummary, ProjectFileEntry } from "../lib/localBackend";
import type { WorkspaceFileOpenAction } from "./workspaceFilesPanelTypes";

export interface WorkspaceFileListModel {
  query: string;
  projectFiles: ProjectFileEntry[];
  gitStatus: GitStatusSummary | null;
  busy: boolean;
  message: string | null;
}

export interface WorkspaceFileListActions {
  copyProjectMarkdown: () => void;
  changeQuery: (query: string) => void;
  openFile: WorkspaceFileOpenAction;
  copyDiffSummaryMarkdown: () => void;
}

export function WorkspaceFileLists({
  model,
  canReadWorkspace,
  actions,
  formatBytes
}: {
  model: WorkspaceFileListModel;
  canReadWorkspace: boolean;
  actions: WorkspaceFileListActions;
  formatBytes: (bytes: number) => string;
}) {
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <span>Files</span>
          <button className="ghost" onClick={actions.copyProjectMarkdown} disabled={!canReadWorkspace}>
            <Copy size={14} /> Markdown
          </button>
        </div>
        <label className="file-search">
          <Search size={14} />
          <input
            value={model.query}
            onChange={(event) => actions.changeQuery(event.target.value)}
            placeholder="Search project files"
            disabled={!canReadWorkspace}
          />
        </label>
        <div className="file-list">
          {model.projectFiles.map((file) => (
            <button
              className="file-row"
              key={file.path}
              onClick={() => actions.openFile(file.path, "file")}
              disabled={!canReadWorkspace}
            >
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <small>{formatBytes(file.size)}</small>
            </button>
          ))}
          {!model.busy && model.projectFiles.length === 0 && (
            <div className="empty-state">No files match this search.</div>
          )}
        </div>
        {model.busy && model.projectFiles.length === 0 && <div className="empty-state">Loading project files...</div>}
        {model.message && <div className="workflow-message">{model.message}</div>}
      </section>

      <section className="panel">
        <div className="panel-title">
          <span>Changed files</span>
          <div className="panel-title-actions">
            <button className="ghost" onClick={actions.copyDiffSummaryMarkdown} disabled={!canReadWorkspace}>
              <Copy size={14} /> Summary
            </button>
            <small className="panel-count">{model.gitStatus?.files.length ?? 0}</small>
          </div>
        </div>
        <div className="diff-list">
          {(model.gitStatus?.files.length ? model.gitStatus.files : []).map((file) => (
            <button
              className="diff-row"
              key={file.path}
              onClick={() => actions.openFile(file.path, "diff")}
              disabled={!canReadWorkspace}
            >
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <small>
                <b>+{file.added}</b> <i>-{file.removed}</i>
              </small>
            </button>
          ))}
          {model.gitStatus?.files.length === 0 && (
            <div className="empty-state">No local file changes in this project.</div>
          )}
        </div>
      </section>
    </>
  );
}

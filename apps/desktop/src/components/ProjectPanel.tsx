import { Check, FolderGit2 } from "lucide-react";

export function ProjectPanel({
  projectPath,
  projectPathDraft,
  branchLabel,
  disabled,
  attachDisabled,
  onProjectPathDraftChange,
  onChooseProjectPath,
  onUseDefaultProjectPath,
  onUpdateProjectPath
}: {
  projectPath: string;
  projectPathDraft: string;
  branchLabel: string;
  disabled: boolean;
  attachDisabled: boolean;
  onProjectPathDraftChange: (path: string) => void;
  onChooseProjectPath: () => void;
  onUseDefaultProjectPath: () => void;
  onUpdateProjectPath: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <span>Project</span>
        <small className="panel-state">{branchLabel}</small>
      </div>
      <div className="project-card">
        <FolderGit2 size={18} />
        <div>
          <strong>multAIplayer</strong>
          <span>{projectPath}</span>
        </div>
      </div>
      <div className="project-path-editor">
        <label>
          <span>Local folder</span>
          <input
            value={projectPathDraft}
            disabled={disabled}
            onChange={(event) => onProjectPathDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onUpdateProjectPath();
              }
            }}
          />
        </label>
        <div>
          <button className="ghost-wide" onClick={onChooseProjectPath} disabled={disabled}>
            <FolderGit2 size={15} />
            Choose folder
          </button>
          <button className="ghost-wide" onClick={onUseDefaultProjectPath} disabled={disabled}>
            <FolderGit2 size={15} />
            Current repo
          </button>
          <button
            className="primary-wide"
            onClick={onUpdateProjectPath}
            disabled={attachDisabled}
          >
            <Check size={15} />
            Attach
          </button>
        </div>
      </div>
    </section>
  );
}

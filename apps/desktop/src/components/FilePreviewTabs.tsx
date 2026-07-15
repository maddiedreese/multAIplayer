import { Code2, FileCode2 } from "lucide-react";
import type { FilePreviewTab } from "../lib/files/filePreview";

export function FilePreviewTabs({
  activeTab,
  hasDiff,
  onSelectTab
}: {
  activeTab: FilePreviewTab;
  hasDiff: boolean;
  onSelectTab: (tab: FilePreviewTab) => void;
}) {
  return (
    <div className="file-preview-tabs">
      <button
        className={activeTab === "file" ? "active" : ""}
        onClick={() => onSelectTab("file")}
        aria-pressed={activeTab === "file"}
      >
        <FileCode2 size={13} />
        File
      </button>
      <button
        className={activeTab === "diff" ? "active" : ""}
        onClick={() => onSelectTab("diff")}
        disabled={!hasDiff}
        aria-pressed={activeTab === "diff"}
      >
        <Code2 size={13} />
        Diff
      </button>
    </div>
  );
}

export type FilePreviewTab = "file" | "diff";

export function resolveFilePreviewTab(tab: FilePreviewTab, hasDiff: boolean): FilePreviewTab {
  return tab === "diff" && hasDiff ? "diff" : "file";
}

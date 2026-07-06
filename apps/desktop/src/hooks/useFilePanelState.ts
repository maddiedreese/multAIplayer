import { useState } from "react";
import type { FilePreviewTab } from "../lib/filePreview";
import type { GitDiffResult, ProjectFileContent, ProjectFileEntry } from "../lib/localBackend";
import type { MarkdownCopyFallback } from "../types";

export function useFilePanelState() {
  const [fileQueriesByRoom, setFileQueriesByRoom] = useState<Record<string, string>>({});
  const [projectFilesByRoom, setProjectFilesByRoom] = useState<Record<string, ProjectFileEntry[]>>({});
  const [selectedFilesByRoom, setSelectedFilesByRoom] = useState<Record<string, ProjectFileContent | null>>({});
  const [selectedDiffsByRoom, setSelectedDiffsByRoom] = useState<Record<string, GitDiffResult | null>>({});
  const [filePreviewTabsByRoom, setFilePreviewTabsByRoom] = useState<Record<string, FilePreviewTab>>({});
  const [fileBusyByRoom, setFileBusyByRoom] = useState<Record<string, boolean>>({});
  const [fileMessagesByRoom, setFileMessagesByRoom] = useState<Record<string, string | null>>({});
  const [markdownCopyFallbacksByRoom, setMarkdownCopyFallbacksByRoom] = useState<Record<string, MarkdownCopyFallback | null>>({});

  return {
    fileQueriesByRoom,
    setFileQueriesByRoom,
    projectFilesByRoom,
    setProjectFilesByRoom,
    selectedFilesByRoom,
    setSelectedFilesByRoom,
    selectedDiffsByRoom,
    setSelectedDiffsByRoom,
    filePreviewTabsByRoom,
    setFilePreviewTabsByRoom,
    fileBusyByRoom,
    setFileBusyByRoom,
    fileMessagesByRoom,
    setFileMessagesByRoom,
    markdownCopyFallbacksByRoom,
    setMarkdownCopyFallbacksByRoom
  };
}

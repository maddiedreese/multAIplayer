import { invokeNative } from "../nativeCommandError";
import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";
import type { ProjectFileContent, ProjectFileEntry, ProjectFileWriteResult } from "./types";

export async function searchProjectFiles(cwd: string, query: string, limit = 80): Promise<ProjectFileEntry[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Project file search");
  return invokeNative<ProjectFileEntry[]>("project_files", {
    request: { cwd, query, limit }
  });
}

export async function readProjectFile(
  cwd: string,
  path: string,
  maxBytes = maxEmbeddedAttachmentBytes
): Promise<ProjectFileContent> {
  if (!isTauriRuntime()) return requireNativeRuntime("Project file reads");
  return invokeNative<ProjectFileContent>("project_file_read", {
    request: { cwd, path, maxBytes }
  });
}

export async function writeProjectFile(
  cwd: string,
  path: string,
  content: string,
  expectedContent?: string
): Promise<ProjectFileWriteResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Project file writes");
  return invokeNative<ProjectFileWriteResult>("project_file_write", {
    request: { cwd, path, content, expectedContent }
  });
}

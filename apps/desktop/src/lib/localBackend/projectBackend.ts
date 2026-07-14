import { invokeNative } from "../nativeCommandError";
import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";

import { isTauriRuntime } from "./runtime";
import type { ProjectFileContent, ProjectFileEntry, ProjectFileWriteResult } from "./types";

export async function searchProjectFiles(cwd: string, query: string, limit = 80): Promise<ProjectFileEntry[]> {
  if (isTauriRuntime()) {
    return invokeNative<ProjectFileEntry[]>("project_files", {
      request: { cwd, query, limit }
    });
  }

  return [
    { path: "apps/desktop/src/App.tsx", size: 42000 },
    { path: "apps/desktop/src/lib/localBackend.ts", size: 8800 },
    { path: "apps/desktop/src-tauri/src/lib.rs", size: 24000 },
    { path: "docs/product-architecture.md", size: 18000 },
    { path: "README.md", size: 940 }
  ].filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()));
}

export async function readProjectFile(
  cwd: string,
  path: string,
  maxBytes = maxEmbeddedAttachmentBytes
): Promise<ProjectFileContent> {
  if (isTauriRuntime()) {
    return invokeNative<ProjectFileContent>("project_file_read", {
      request: { cwd, path, maxBytes }
    });
  }

  return {
    path,
    size: 512,
    truncated: false,
    content: [
      `// Preview mode for ${path}`,
      "Open the Tauri app to read real project files from the selected room folder.",
      "",
      "export const multAIplayer = 'private group chat for coding with Codex';"
    ].join("\n")
  };
}

export async function writeProjectFile(cwd: string, path: string, content: string): Promise<ProjectFileWriteResult> {
  if (isTauriRuntime()) {
    return invokeNative<ProjectFileWriteResult>("project_file_write", {
      request: { cwd, path, content }
    });
  }

  return {
    path,
    size: new TextEncoder().encode(content).length
  };
}

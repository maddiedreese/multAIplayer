export interface CodexTurnSummary {
  messagesSinceLastCodex: number;
  attachments: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    storage: "inline" | "encrypted_blob";
    contentIncluded: boolean;
  }>;
  workspacePath: string | null;
  git: {
    branch: string;
    files: Array<{ path: string; status: string; added: number; removed: number }>;
    totalFiles: number;
    truncated: boolean;
  } | null;
  browserAccess: string[];
  terminals: string[];
}

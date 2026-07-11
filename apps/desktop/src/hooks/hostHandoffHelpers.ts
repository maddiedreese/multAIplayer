import type { HostHandoffPlaintextPayload } from "@multaiplayer/protocol";
import {
  chooseProjectFolder,
  cloneGitRepository,
  defaultProjectPath,
  getGitRemoteOrigin,
  type GitApplyPatchResult,
  type GitCloneResult
} from "../lib/localBackend";
import { formatCodexModel } from "../lib/appFormatters";
import { handoffRepoIdentity, hostHandoffDetail, sameHandoffRepo } from "../lib/hostHandoff";
import { parseGitHubRemoteUrl } from "../lib/gitWorkflowDraft";
import type { HostHandoffRecord, QueuedCodexTurn } from "../types";

export interface HandoffProject {
  path: string;
  source: "existing" | "cloned" | "selected";
  cloneResult?: GitCloneResult;
  patchResult?: GitApplyPatchResult;
}

export async function resolveHandoffProject(handoff: HostHandoffRecord, fallbackPath: string): Promise<HandoffProject> {
  const expectedRepo = handoffRepoIdentity(handoff);
  async function pathMatches(path: string): Promise<boolean> {
    if (!expectedRepo) return true;
    const remote = await getGitRemoteOrigin(path).catch(() => ({ originUrl: null }));
    const actualRepo = remote.originUrl ? parseGitHubRemoteUrl(remote.originUrl) : null;
    return sameHandoffRepo(expectedRepo, actualRepo);
  }
  if (await pathMatches(fallbackPath)) return { path: fallbackPath, source: "existing" };
  if (handoff.gitRemoteUrl && expectedRepo) {
    const parentDir = defaultProjectPath.slice(0, defaultProjectPath.lastIndexOf("/")) || defaultProjectPath;
    const cloneResult = await cloneGitRepository(handoff.gitRemoteUrl, parentDir, handoff.gitBranch);
    if (cloneResult.status === 0 && (await pathMatches(cloneResult.path)))
      return { path: cloneResult.path, source: "cloned", cloneResult };
    throw new Error(
      `Could not clone ${expectedRepo.owner}/${expectedRepo.repo}: ${cloneResult.stderr || cloneResult.stdout || "git clone failed"}`
    );
  }
  const selected = await chooseProjectFolder(defaultProjectPath);
  if (!selected) throw new Error(`${hostHandoffDetail(handoff)} No local project folder was selected.`);
  if (!(await pathMatches(selected))) {
    const repoLabel = expectedRepo ? `${expectedRepo.owner}/${expectedRepo.repo}` : "the handoff repository";
    throw new Error(`Selected folder is not a clone of ${repoLabel}. Choose a local clone or continue from GitHub.`);
  }
  return { path: selected, source: "selected" };
}

export function buildAcceptedHandoffMessage(
  handoff: HostHandoffRecord,
  project: Pick<HandoffProject, "path" | "source">,
  codexModel: string
): string {
  const source =
    project.source === "cloned"
      ? "cloned from GitHub"
      : project.source === "selected"
        ? "selected locally"
        : "matched locally";
  const patchMessage =
    handoff.gitPatch && !handoff.gitPatchTruncated
      ? " Applied the previous host's local patch."
      : handoff.gitPatchTruncated
        ? " The previous host's patch was too large to apply automatically; ask them to push or share it."
        : handoff.gitDirtyFiles?.length
          ? " The previous host had local changes but no transferable patch was available."
          : "";
  return `Accepted handoff from ${handoff.fromHost}; ${source}, using ${formatCodexModel(codexModel)} at ${project.path}.${patchMessage}`;
}

export function queueForHandoff(
  roomId: string,
  turns: QueuedCodexTurn[]
): HostHandoffPlaintextPayload["queuedCodexTurns"] {
  return turns
    .filter((turn) => turn.roomId === roomId)
    .slice(0, 5)
    .map((turn) => ({
      turnId: turn.turnId,
      requestedBy: turn.requestedBy,
      requestedByUserId: turn.requestedByUserId,
      queuedAt: turn.queuedAt,
      ...(turn.triggerMessageId ? { triggerMessageId: turn.triggerMessageId } : {})
    }));
}

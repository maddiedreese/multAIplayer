import type { HostHandoffPlaintextPayload } from "@multaiplayer/protocol";
import {
  chooseProjectFolder,
  cloneGitRepository,
  defaultProjectPath,
  getGitRemoteOrigin,
  type GitApplyPatchResult,
  type GitCloneResult
} from "../../lib/platform/localBackend";
import { formatCodexModel } from "../../lib/formatting/appFormatters";
import { handoffRepoIdentity, hostHandoffDetail, sameHandoffRepo } from "../../lib/handoff/hostHandoff";
import { parseGitHubRemoteUrl } from "../../lib/git/gitWorkflowDraft";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";
import type { HostHandoffRecord, QueuedCodexTurn } from "../../types";

export interface HandoffProject {
  path: string;
  source: "existing" | "cloned" | "selected";
  cloneResult?: GitCloneResult;
  patchResult?: GitApplyPatchResult;
}

const resolvedHandoffProjects = new Map<string, HandoffProject>();

function rememberHandoffProject(handoffId: string, project: HandoffProject): HandoffProject {
  resolvedHandoffProjects.delete(handoffId);
  resolvedHandoffProjects.set(handoffId, project);
  while (resolvedHandoffProjects.size > 32) {
    const oldest = resolvedHandoffProjects.keys().next().value;
    if (oldest === undefined) break;
    resolvedHandoffProjects.delete(oldest);
  }
  return project;
}

export async function resolveHandoffProject(
  handoff: HostHandoffRecord,
  approvedProjectPath?: string
): Promise<HandoffProject> {
  const expectedRepo = handoffRepoIdentity(handoff);
  async function repoAtPath(path: string) {
    const remote = await getGitRemoteOrigin(path).catch(() => {
      reportExpectedFailure("Git remote was unavailable while resolving a host handoff project");
      return { originUrl: null };
    });
    return remote.originUrl ? parseGitHubRemoteUrl(remote.originUrl) : null;
  }
  const resolved = resolvedHandoffProjects.get(handoff.id);
  if (resolved && (!expectedRepo || sameHandoffRepo(expectedRepo, await repoAtPath(resolved.path)))) return resolved;

  if (approvedProjectPath && (!expectedRepo || sameHandoffRepo(expectedRepo, await repoAtPath(approvedProjectPath)))) {
    return rememberHandoffProject(handoff.id, { path: approvedProjectPath, source: "existing" });
  }

  const selected = await chooseProjectFolder(defaultProjectPath);
  if (!selected) throw new Error(`${hostHandoffDetail(handoff)} No local project folder was selected.`);
  if (!expectedRepo) return rememberHandoffProject(handoff.id, { path: selected, source: "selected" });

  const selectedRepo = await repoAtPath(selected);
  if (sameHandoffRepo(expectedRepo, selectedRepo)) {
    return rememberHandoffProject(handoff.id, { path: selected, source: "selected" });
  }
  if (selectedRepo) {
    throw new Error(`Selected folder is not a clone of ${expectedRepo.owner}/${expectedRepo.repo}.`);
  }
  if (handoff.gitRemoteUrl) {
    const cloneResult = await cloneGitRepository(handoff.gitRemoteUrl, selected, handoff.gitBranch);
    if (cloneResult.status === 0 && sameHandoffRepo(expectedRepo, await repoAtPath(cloneResult.path)))
      return rememberHandoffProject(handoff.id, { path: cloneResult.path, source: "cloned", cloneResult });
    throw new Error(
      `Could not clone ${expectedRepo.owner}/${expectedRepo.repo}: ${cloneResult.stderr || cloneResult.stdout || "git clone failed"}`
    );
  }
  throw new Error(`Selected folder is not a clone of ${expectedRepo.owner}/${expectedRepo.repo}.`);
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
      ? handoff.patchAppliedLocally
        ? " Applied the previous host's locally reviewed patch."
        : " The previous host's patch is staged and requires explicit review before it is applied."
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

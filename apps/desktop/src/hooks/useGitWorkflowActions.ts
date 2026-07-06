import type { MutableRefObject } from "react";
import type { GitWorkflowEventPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import { createPullRequest } from "../lib/authClient";
import {
  getGitStatus,
  runGitWorkflow,
  type GitStatusSummary
} from "../lib/localBackend";
import { buildPullRequestBody } from "../lib/markdownExport";
import {
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  type GitWorkflowDraft,
  type buildGitWorkflowApprovalPreview
} from "../lib/gitWorkflowDraft";
import type {
  GitHubActionsTarget,
  GitHubWorkflowReadiness
} from "../lib/githubWorkflowReadiness";
import type { ChatMessage } from "../types";

interface UseGitWorkflowActionsOptions {
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  hostGateMessage: string;
  localWorkspaceMessage: string;
  selectedRoom: RoomRecord;
  gitWorkflowBusyRef: MutableRefObject<Record<string, boolean>>;
  gitWorkflowDraft: GitWorkflowDraft;
  gitApprovalPreview: ReturnType<typeof buildGitWorkflowApprovalPreview>;
  githubWorkflowReadiness: GitHubWorkflowReadiness;
  messages: ChatMessage[];
  gitStatus: GitStatusSummary | null;
  setSelectedGitWorkflowMessage: (message: string | null) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  publishGitWorkflowEvent: (
    event: Omit<GitWorkflowEventPlaintextPayload, "eventType" | "runner" | "runnerUserId" | "createdAt">,
    room?: RoomRecord
  ) => Promise<void>;
  refreshGitHubActions: (roomArg?: RoomRecord, targetArg?: GitHubActionsTarget) => Promise<void>;
}

export function useGitWorkflowActions({
  hasSelectedRoom,
  isActiveHost,
  canReadLocalWorkspace,
  hostGateMessage,
  localWorkspaceMessage,
  selectedRoom,
  gitWorkflowBusyRef,
  gitWorkflowDraft,
  gitApprovalPreview,
  githubWorkflowReadiness,
  messages,
  gitStatus,
  setSelectedGitWorkflowMessage,
  setGitWorkflowMessageForRoom,
  setGitWorkflowBusyForRoom,
  appendTerminalLinesForRoom,
  setGitStatusForRoom,
  publishGitWorkflowEvent,
  refreshGitHubActions
}: UseGitWorkflowActionsOptions) {
  async function approveGitWorkflow() {
    if (!hasSelectedRoom) {
      setSelectedGitWorkflowMessage("Create or join a room before approving a git workflow.");
      return;
    }
    if (!isActiveHost) {
      setSelectedGitWorkflowMessage(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedGitWorkflowMessage(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (isGitWorkflowInFlight(gitWorkflowBusyRef.current, roomId)) {
      setGitWorkflowMessageForRoom(roomId, gitWorkflowInFlightMessage());
      return;
    }
    const projectPath = room.projectPath;
    const workflowDraft = gitWorkflowDraft;
    if (!gitApprovalPreview.plan) {
      setGitWorkflowMessageForRoom(roomId, gitApprovalPreview.error ?? "Git workflow approval preview is invalid.");
      return;
    }
    if (workflowDraft.pushEnabled && !githubWorkflowReadiness.ready) {
      setGitWorkflowMessageForRoom(roomId, githubWorkflowReadiness.messages.join(" "));
      return;
    }
    const gitPlan = gitApprovalPreview.plan;
    const normalizedPrBase = workflowDraft.pushEnabled ? githubWorkflowReadiness.normalizedBase : gitApprovalPreview.normalizedBase;
    setGitWorkflowBusyForRoom(roomId, true);
    setGitWorkflowMessageForRoom(roomId, null);
    appendTerminalLinesForRoom(roomId, [
      `Approve git workflow: branch=${gitPlan.branch}, push=${gitPlan.push}`,
      ...gitPlan.approvals.flatMap((approval) => approval.commands.map((command) => `$ ${command}`))
    ]);
    publishGitWorkflowEvent({
      status: "started",
      branch: gitPlan.branch,
      push: gitPlan.push,
      message: `Started Git workflow on ${gitPlan.branch}.`
    }, room).catch((error) => {
      console.warn("Failed to publish git workflow start", error);
    });
    try {
      const results = await runGitWorkflow(
        gitPlan.cwd,
        gitPlan.branch,
        gitPlan.message,
        gitPlan.push
      );
      appendTerminalLinesForRoom(roomId, [
        ...results
          .flatMap((result) => [
            `$ ${result.command}`,
            result.stdout.trim(),
            result.stderr.trim()
          ])
          .filter(Boolean)
      ]);

      const failed = results.find((result) => result.status !== 0);
      if (failed) {
        const message = `Stopped after failed command: ${failed.command}`;
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "failed",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow failure", error);
        });
        return;
      }

      if (gitPlan.push) {
        const pr = await createPullRequest({
          owner: workflowDraft.prOwner,
          repo: workflowDraft.prRepo,
          title: gitPlan.message,
          body: buildPullRequestBody(messages, gitStatus?.files ?? []),
          head: gitPlan.branch,
          base: normalizedPrBase,
          draft: true
        });
        const message = `Opened draft PR #${pr.number}: ${pr.url}`;
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "pr_opened",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results,
          pullRequest: {
            number: pr.number,
            url: pr.url
          }
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow PR event", error);
        });
        refreshGitHubActions(room, {
          owner: workflowDraft.prOwner,
          repo: workflowDraft.prRepo,
          branch: gitPlan.branch
        });
      } else {
        const message = "Created local branch and commit. Enable push when you are ready to open a PR.";
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "completed",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow completion", error);
        });
      }

      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      const message = String(error);
      setGitWorkflowMessageForRoom(roomId, message);
      appendTerminalLinesForRoom(roomId, [`Git workflow error: ${message}`]);
      publishGitWorkflowEvent({
        status: "failed",
        branch: gitPlan?.branch ?? workflowDraft.branchName,
        push: gitPlan?.push ?? workflowDraft.pushEnabled,
        message
      }, room).catch((publishError) => {
        console.warn("Failed to publish git workflow error", publishError);
      });
    } finally {
      setGitWorkflowBusyForRoom(roomId, false);
    }
  }

  return {
    approveGitWorkflow
  };
}

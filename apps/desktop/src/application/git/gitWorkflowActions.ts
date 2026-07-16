import type { MutableRefObject } from "react";
import type { GitWorkflowEventPlaintextPayload, ClientRoomRecord } from "@multaiplayer/protocol";
import { createPullRequest } from "../../lib/identity/authClient";
import { getGitStatus, runGitWorkflow } from "../../lib/platform/localBackend";
import { buildPullRequestBody } from "../../lib/files/markdownExport";
import {
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  buildGitWorkflowApprovalPreview,
  resolveGitWorkflowDraft
} from "../../lib/git/gitWorkflowDraft";
import { checkGitHubWorkflowReadiness, type GitHubActionsTarget } from "../../lib/git/githubWorkflowReadiness";
import { useAppStore } from "../../store/appStore";
import { omitRecordKey } from "../../lib/core/setUtils";
import { currentSelectedRoom, currentSelectedRoomContext } from "../workspace/selectedWorkspace";
import { reportNonFatal } from "../../lib/core/nonFatalReporting";

interface GitWorkflowActionsOptions {
  gitWorkflowBusyRef: MutableRefObject<Record<string, boolean>>;
  maxTerminalActivityLines: number;
  publishGitWorkflowEvent: (
    event: Omit<GitWorkflowEventPlaintextPayload, "eventType" | "runner" | "runnerUserId" | "createdAt">,
    room?: ClientRoomRecord
  ) => Promise<void>;
  refreshGitHubActions: (roomArg?: ClientRoomRecord, targetArg?: GitHubActionsTarget) => Promise<void>;
}

export function createGitWorkflowActions({
  gitWorkflowBusyRef,
  maxTerminalActivityLines,
  publishGitWorkflowEvent,
  refreshGitHubActions
}: GitWorkflowActionsOptions) {
  const currentContext = () => currentSelectedRoomContext();
  function setGitWorkflowBusyForRoom(roomId: string, busy: boolean) {
    gitWorkflowBusyRef.current = busy
      ? { ...gitWorkflowBusyRef.current, [roomId]: true }
      : omitRecordKey(gitWorkflowBusyRef.current, roomId);
    useAppStore.getState().setGitWorkflowBusyForRoom(roomId, busy);
  }

  function appendTerminalLinesForRoom(roomId: string, lines: string[]) {
    useAppStore.getState().appendTerminalLinesForRoom(roomId, lines, maxTerminalActivityLines);
  }

  async function approveGitWorkflow() {
    const approval = gitWorkflowApprovalContext();
    if (!approval) return;
    const { room, workflowDraft, gitApprovalPreview, githubWorkflowReadiness } = approval;
    const roomId = room.id;
    const projectPath = room.projectPath;
    const gitPlan = gitApprovalPreview.plan!;
    const normalizedPrBase = resolvedPullRequestBase(
      workflowDraft.pushEnabled,
      githubWorkflowReadiness.normalizedBase,
      gitApprovalPreview.normalizedBase
    );
    setGitWorkflowBusyForRoom(roomId, true);
    useAppStore.getState().setGitWorkflowMessageForRoom(roomId, null);
    appendTerminalLinesForRoom(roomId, [
      `Approve git workflow: branch=${gitPlan.branch}, push=${gitPlan.push}`,
      ...gitPlan.approvals.flatMap((approval) => approval.commands.map((command) => `$ ${command}`))
    ]);
    publishGitWorkflowEvent(
      {
        status: "started",
        branch: gitPlan.branch,
        push: gitPlan.push,
        message: `Started Git workflow on ${gitPlan.branch}.`
      },
      room
    ).catch((error) => {
      reportNonFatal("publish git workflow start", error);
    });
    try {
      const results = await runGitWorkflow(gitPlan.cwd, gitPlan.branch, gitPlan.message, gitPlan.push);
      appendTerminalLinesForRoom(roomId, [
        ...results
          .flatMap((result) => [`$ ${result.command}`, result.stdout.trim(), result.stderr.trim()])
          .filter(Boolean)
      ]);

      const failed = results.find((result) => result.status !== 0);
      if (failed) {
        const message = `Stopped after failed command: ${failed.command}`;
        useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent(
          {
            status: "failed",
            branch: gitPlan.branch,
            push: gitPlan.push,
            message,
            results
          },
          room
        ).catch((error) => {
          reportNonFatal("publish git workflow failure", error);
        });
        return;
      }

      if (gitPlan.push) {
        const store = useAppStore.getState();
        const messages = store.messagesByRoom[roomId] ?? [];
        const gitStatus = store.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null;
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
        useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent(
          {
            status: "pr_opened",
            branch: gitPlan.branch,
            push: gitPlan.push,
            message,
            results,
            pullRequest: {
              number: pr.number,
              url: pr.url
            }
          },
          room
        ).catch((error) => {
          reportNonFatal("publish git workflow PR event", error);
        });
        refreshGitHubActions(room, {
          owner: workflowDraft.prOwner,
          repo: workflowDraft.prRepo,
          branch: gitPlan.branch
        });
      } else {
        const message = "Created local branch and commit. Enable push when you are ready to open a PR.";
        useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent(
          {
            status: "completed",
            branch: gitPlan.branch,
            push: gitPlan.push,
            message,
            results
          },
          room
        ).catch((error) => {
          reportNonFatal("publish git workflow completion", error);
        });
      }

      const status = await getGitStatus(projectPath);
      useAppStore.getState().setGitStatusForRoom(roomId, status);
    } catch (error) {
      const message = String(error);
      useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message);
      appendTerminalLinesForRoom(roomId, [`Git workflow error: ${message}`]);
      publishGitWorkflowEvent(
        {
          status: "failed",
          branch: gitPlan?.branch ?? workflowDraft.branchName,
          push: gitPlan?.push ?? workflowDraft.pushEnabled,
          message
        },
        room
      ).catch((publishError) => {
        reportNonFatal("publish git workflow error", publishError);
      });
    } finally {
      setGitWorkflowBusyForRoom(roomId, false);
    }
  }

  function gitWorkflowApprovalContext() {
    const room = currentSelectedRoom();
    const state = useAppStore.getState();
    if (!room) {
      return null;
    }
    const context = currentContext();
    const gateMessage = !context?.isActiveHost
      ? (context?.hostGateMessage ?? "Claim host before continuing.")
      : !context.canReadLocalWorkspace
        ? (context.localWorkspaceMessage ?? "Workspace unavailable.")
        : null;
    if (gateMessage) {
      state.setGitWorkflowMessageForRoom(room.id, gateMessage);
      return null;
    }
    if (isGitWorkflowInFlight(gitWorkflowBusyRef.current, room.id)) {
      state.setGitWorkflowMessageForRoom(room.id, gitWorkflowInFlightMessage());
      return null;
    }
    const workflowDraft = currentGitWorkflowDraft(state, room.id);
    const gitApprovalPreview = buildGitWorkflowApprovalPreview(room.projectPath, workflowDraft);
    const githubWorkflowReadiness = checkGitHubWorkflowReadiness({
      pushEnabled: workflowDraft.pushEnabled,
      authConfig: state.authConfig,
      currentUser: state.currentUser,
      owner: workflowDraft.prOwner,
      repo: workflowDraft.prRepo,
      head: workflowDraft.branchName,
      base: workflowDraft.prBase
    });
    const error = !gitApprovalPreview.plan
      ? (gitApprovalPreview.error ?? "Git workflow approval preview is invalid.")
      : workflowDraft.pushEnabled && !githubWorkflowReadiness.ready
        ? githubWorkflowReadiness.messages.join(" ")
        : null;
    if (error) {
      state.setGitWorkflowMessageForRoom(room.id, error);
      return null;
    }
    return { room, workflowDraft, gitApprovalPreview, githubWorkflowReadiness };
  }

  return {
    approveGitWorkflow
  };
}

function currentGitWorkflowDraft(state: ReturnType<typeof useAppStore.getState>, roomId: string) {
  return resolveGitWorkflowDraft({ [roomId]: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.draft ?? {} }, roomId);
}

function resolvedPullRequestBase(pushEnabled: boolean, readyBase: string, previewBase: string): string {
  return pushEnabled ? readyBase : previewBase;
}

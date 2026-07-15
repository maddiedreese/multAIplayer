import type { MutableRefObject } from "react";
import type { GitWorkflowEventPlaintextPayload, ClientRoomRecord } from "@multaiplayer/protocol";
import { createPullRequest } from "./authClient";
import { getGitStatus, runGitWorkflow } from "./localBackend";
import { buildPullRequestBody } from "./markdownExport";
import {
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  buildGitWorkflowApprovalPreview,
  resolveGitWorkflowDraft
} from "./gitWorkflowDraft";
import { checkGitHubWorkflowReadiness, type GitHubActionsTarget } from "./githubWorkflowReadiness";
import { useAppStore } from "../store/appStore";
import { omitRecordKey } from "./setUtils";
import { currentSelectedRoom, currentSelectedRoomContext } from "./selectedWorkspace";

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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before approving a git workflow."
        );
      return;
    }
    if (!currentContext()?.isActiveHost) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(
          selectedRoom.id,
          currentContext()?.hostGateMessage ?? "Claim host before continuing."
        );
      return;
    }
    if (!currentContext()?.canReadLocalWorkspace) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(
          selectedRoom.id,
          currentContext()?.localWorkspaceMessage ?? "Workspace unavailable."
        );
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (isGitWorkflowInFlight(gitWorkflowBusyRef.current, roomId)) {
      useAppStore.getState().setGitWorkflowMessageForRoom(roomId, gitWorkflowInFlightMessage());
      return;
    }
    const projectPath = room.projectPath;
    const state = useAppStore.getState();
    const workflowDraft = resolveGitWorkflowDraft(
      {
        [roomId]: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.draft ?? {}
      },
      roomId
    );
    const gitApprovalPreview = buildGitWorkflowApprovalPreview(projectPath, workflowDraft);
    const githubWorkflowReadiness = checkGitHubWorkflowReadiness({
      pushEnabled: workflowDraft.pushEnabled,
      authConfig: state.authConfig,
      currentUser: state.currentUser,
      owner: workflowDraft.prOwner,
      repo: workflowDraft.prRepo,
      head: workflowDraft.branchName,
      base: workflowDraft.prBase
    });
    if (!gitApprovalPreview.plan) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(roomId, gitApprovalPreview.error ?? "Git workflow approval preview is invalid.");
      return;
    }
    if (workflowDraft.pushEnabled && !githubWorkflowReadiness.ready) {
      useAppStore.getState().setGitWorkflowMessageForRoom(roomId, githubWorkflowReadiness.messages.join(" "));
      return;
    }
    const gitPlan = gitApprovalPreview.plan;
    const normalizedPrBase = workflowDraft.pushEnabled
      ? githubWorkflowReadiness.normalizedBase
      : gitApprovalPreview.normalizedBase;
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
    ).catch(() => {
      console.warn("Failed to publish git workflow start");
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
        ).catch(() => {
          console.warn("Failed to publish git workflow failure");
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
        ).catch(() => {
          console.warn("Failed to publish git workflow PR event");
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
        ).catch(() => {
          console.warn("Failed to publish git workflow completion");
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
      ).catch(() => {
        console.warn("Failed to publish git workflow error");
      });
    } finally {
      setGitWorkflowBusyForRoom(roomId, false);
    }
  }

  return {
    approveGitWorkflow
  };
}

import type { MutableRefObject } from "react";
import type {
  CodexSandboxLevel,
  HostHandoffPlaintextPayload,
  RelayEnvelope,
  RoomRecord
} from "@multaiplayer/protocol";
import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import { encryptJson } from "@multaiplayer/crypto";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import {
  applyGitPatch,
  chooseProjectFolder,
  cloneGitRepository,
  createGitPatch,
  defaultProjectPath,
  getGitRemoteOrigin,
  shutdownCodexRoom,
  type GitApplyPatchResult,
  type GitCloneResult,
  type GitStatusSummary,
  type TerminalSnapshot
} from "../lib/localBackend";
import { updateRoomHost, updateRoomSettings } from "../lib/workspaceClient";
import { buildCodexTurnSummary } from "../lib/codexTurn";
import { codexUsageLimitMessage } from "../lib/codexFailure";
import {
  canAcceptRoomHostHandoff,
  createHandoffSettingsPatch,
  findRoomHostHandoff,
  handoffRepoIdentity,
  hostHandoffDetail,
  roomHostHandoffMessage,
  sameHandoffRepo
} from "../lib/hostHandoff";
import { parseGitHubRemoteUrl } from "../lib/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { roomLockMessage } from "../lib/appRuntime";
import { formatCodexModel } from "../lib/appFormatters";
import { useAppStore } from "../store/appStore";
import type { RelayClient } from "../lib/relayClient";
import type {
  BrowserAccessRequest,
  ChatMessage,
  HostHandoffRecord,
  RelayStatus
} from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface HandoffProject {
  path: string;
  source: "existing" | "cloned" | "selected";
  cloneResult?: GitCloneResult;
  patchResult?: GitApplyPatchResult;
}

interface UseHostHandoffActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  hostGateMessage: string;
  hostHandoffs: HostHandoffRecord[];
  localUser: LocalUser;
  deviceId: string;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  messages: ChatMessage[];
  terminals: TerminalSnapshot[];
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
  gitStatus: GitStatusSummary | null;
  gitStatusByRoom: Record<string, GitStatusSummary | null>;
  reportRoomHostMutationInFlight: (roomId: string) => boolean;
  roomSettingsActor: () => {
    requesterName: string;
    requesterUserId: string;
  };
  replaceRoom: (room: RoomRecord) => void;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedHostMessage: (message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string) => void;
  setCustomCodexModelForRoom: (roomId: string, codexModel: string) => void;
  resetFileContextForRoom: (roomId: string) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
}

export function useHostHandoffActions({
  hasSelectedRoom,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  hostGateMessage,
  hostHandoffs,
  localUser,
  deviceId,
  relayStatus,
  relayRef,
  seenEnvelopeIds,
  messages,
  terminals,
  browserRequestsByRoom,
  gitStatus,
  gitStatusByRoom,
  reportRoomHostMutationInFlight,
  roomSettingsActor,
  replaceRoom,
  setHostBusyForRoom,
  setHostMessageForRoom,
  setSelectedHostMessage,
  setSettingsMessageForRoom,
  setProjectPathDraftForRoom,
  setCustomCodexModelForRoom,
  resetFileContextForRoom,
  resetCodexApprovalForRoom,
  appendHostHandoff
}: UseHostHandoffActionsOptions) {
  const markHostHandoffAcceptedForRoom = useAppStore((state) => state.markHostHandoffAcceptedForRoom);
  const markLatestHostHandoffAcceptedForRoom = useAppStore((state) => state.markLatestHostHandoffAcceptedForRoom);
  const setCodexContinuationForRoom = useAppStore((state) => state.setCodexContinuationForRoom);

  async function setRoomHost(hostStatus: RoomRecord["hostStatus"]) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before changing the host.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedHostMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (hostStatus !== "active" && !isActiveHost) {
      setSelectedHostMessage(hostGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomHostMutationInFlight(roomId)) return;
    setHostBusyForRoom(roomId, true);
    setHostMessageForRoom(roomId, null);
    try {
      const host = hostStatus === "active" ? localUser.name : hostStatus === "handoff" ? selectedRoom.host : "No host";
      const hostUserId = hostStatus === "active" ? localUser.id : selectedRoom.hostUserId ?? localUser.id;
      const room = await updateRoomHost(roomId, host, hostUserId, hostStatus);
      if (hostStatus !== "active") void shutdownCodexRoom(roomId);
      replaceRoom(room);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHostMessageForRoom(
          roomId,
          hostStatus === "active"
            ? `You are hosting ${room.name}.`
            : hostStatus === "handoff"
              ? `${room.name} is ready for host handoff.`
              : `${room.name} no longer has an active host.`
        );
      }
      if (hostStatus === "handoff") {
        await publishHostHandoff(room);
      }
      if (hostStatus === "active") {
        markLatestHostHandoffAcceptedForRoom(room.id);
        setCodexContinuationForRoom(room.id, null);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }

  async function acceptHostHandoff(handoff: HostHandoffRecord) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before accepting a host handoff.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedHostMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomHostMutationInFlight(roomId)) return;
    if (handoff.status !== "available") {
      setSelectedHostMessage("This host handoff has already been accepted.");
      return;
    }
    const roomHandoff = findRoomHostHandoff(hostHandoffs, handoff.id);
    if (!roomHandoff || !canAcceptRoomHostHandoff(hostHandoffs, handoff.id)) {
      setHostMessageForRoom(roomId, roomHostHandoffMessage(hostHandoffs, handoff.id));
      return;
    }
    setHostBusyForRoom(roomId, true);
    setHostMessageForRoom(roomId, null);
    try {
      const patch = createHandoffSettingsPatch(roomHandoff);
      const handoffProject = await resolveHandoffProject(roomHandoff, patch.projectPath);
      if (roomHandoff.gitPatch && !roomHandoff.gitPatchTruncated) {
        const patchResult = await applyGitPatch(handoffProject.path, roomHandoff.gitPatch);
        if (patchResult.status !== 0) {
          throw new Error(`Cloned or selected the repository, but could not apply ${roomHandoff.fromHost}'s local patch: ${patchResult.stderr || patchResult.stdout || "git apply failed"}`);
        }
      }
      const handoffProjectPath = handoffProject.path;
      const updatedSettings = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        ...patch,
        projectPath: handoffProjectPath
      });
      const claimed = await updateRoomHost(updatedSettings.id, localUser.name, localUser.id, "active");
      void shutdownCodexRoom(roomId);
      replaceRoom(claimed);
      markHostHandoffAccepted(roomId, roomHandoff.id);
      await publishHostHandoffAccepted(selectedRoom, roomHandoff);
      setCodexContinuationForRoom(roomId, roomHandoff.reason === "usage_limit" ? roomHandoff : null);
      resetFileContextForRoom(roomId);
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setProjectPathDraftForRoom(roomId, handoffProjectPath);
        setCustomCodexModelForRoom(roomId, patch.codexModel);
        setSettingsMessageForRoom(
          roomId,
          buildAcceptedHandoffMessage(roomHandoff, handoffProject, patch.codexModel)
        );
        setHostMessageForRoom(
          roomId,
          roomHandoff.reason === "usage_limit"
            ? `You are now hosting ${claimed.name}. Codex will continue with the full room context on the next approved turn.`
            : `You are now hosting ${claimed.name} from ${roomHandoff.fromHost}'s handoff.`
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }

  async function resolveHandoffProject(
    handoff: HostHandoffRecord,
    fallbackPath: string
  ): Promise<HandoffProject> {
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
      if (cloneResult.status === 0 && await pathMatches(cloneResult.path)) {
        return { path: cloneResult.path, source: "cloned", cloneResult };
      }
      throw new Error(`Could not clone ${expectedRepo.owner}/${expectedRepo.repo}: ${cloneResult.stderr || cloneResult.stdout || "git clone failed"}`);
    }

    const selected = await chooseProjectFolder(defaultProjectPath);
    if (!selected) {
      throw new Error(`${hostHandoffDetail(handoff)} No local project folder was selected.`);
    }
    if (!(await pathMatches(selected))) {
      const repoLabel = expectedRepo ? `${expectedRepo.owner}/${expectedRepo.repo}` : "the handoff repository";
      throw new Error(`Selected folder is not a clone of ${repoLabel}. Choose a local clone or continue from GitHub.`);
    }
    return { path: selected, source: "selected" };
  }

  function buildAcceptedHandoffMessage(
    handoff: HostHandoffRecord,
    project: { path: string; source: "existing" | "cloned" | "selected" },
    codexModel: string
  ): string {
    const source =
      project.source === "cloned"
        ? "cloned from GitHub"
        : project.source === "selected"
          ? "selected locally"
          : "matched locally";
    const patchMessage = handoff.gitPatch && !handoff.gitPatchTruncated
      ? " Applied the previous host's local patch."
      : handoff.gitPatchTruncated
        ? " The previous host's patch was too large to apply automatically; ask them to push or share it."
        : handoff.gitDirtyFiles?.length
          ? " The previous host had local changes but no transferable patch was available."
          : "";
    return `Accepted handoff from ${handoff.fromHost}; ${source}, using ${formatCodexModel(codexModel)} at ${project.path}.${patchMessage}`;
  }

  async function publishHostHandoff(
    room: RoomRecord,
    reason: HostHandoffRecord["reason"] = "manual",
    contextMessages: ChatMessage[] = messages
  ) {
    const remoteInfo = await getGitRemoteOrigin(room.projectPath).catch(() => ({ originUrl: null }));
    const repoRef = remoteInfo.originUrl ? parseGitHubRemoteUrl(remoteInfo.originUrl) : null;
    const roomGitStatus = room.id === selectedRoom.id ? gitStatus : gitStatusByRoom[room.id] ?? null;
    const patchResult = roomGitStatus?.files.length
      ? await createGitPatch(room.projectPath).catch(() => null)
      : null;
    const summary = buildCodexTurnSummary(
      contextMessages,
      room,
      terminals,
      browserRequestsByRoom[room.id] ?? [],
      roomGitStatus
    );
    const handoff: HostHandoffRecord = {
      id: crypto.randomUUID(),
      fromHost: localUser.name,
      fromUserId: localUser.id,
      reason,
      projectPath: room.projectPath,
      ...(remoteInfo.originUrl ? { gitRemoteUrl: remoteInfo.originUrl } : {}),
      ...(repoRef ? { gitRepoOwner: repoRef.owner, gitRepoName: repoRef.repo } : {}),
      ...(roomGitStatus?.branch ? { gitBranch: roomGitStatus.branch } : {}),
      ...(roomGitStatus?.files.length ? { gitDirtyFiles: roomGitStatus.files.slice(0, 50).map((file) => file.path) } : {}),
      ...(patchResult?.patch && !patchResult.truncated ? { gitPatch: patchResult.patch } : {}),
      ...(patchResult?.truncated ? { gitPatchTruncated: true } : {}),
      codexModel: room.codexModel,
      codexSandboxLevel: (room.codexSandboxLevel ?? defaultCodexSandboxLevel) as CodexSandboxLevel,
      approvalPolicy: room.approvalPolicy,
      messagesSinceLastCodex: summary.messagesSinceLastCodex,
      attachmentNames: summary.attachments.map((attachment) => attachment.name),
      terminals: summary.terminals,
      continuationSummary: reason === "usage_limit"
        ? codexUsageLimitMessage(localUser.name)
        : undefined,
      createdAt: new Date().toISOString(),
      status: "available"
    };
    appendHostHandoff(room.id, handoff);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      setHostMessageForRoom(room.id, "Host handoff package saved locally because the relay is not connected.");
      return;
    }

    const payload: HostHandoffPlaintextPayload = {
      id: handoff.id,
      fromHost: handoff.fromHost,
      fromUserId: handoff.fromUserId,
      reason: handoff.reason,
      projectPath: handoff.projectPath,
      gitRemoteUrl: handoff.gitRemoteUrl,
      gitRepoOwner: handoff.gitRepoOwner,
      gitRepoName: handoff.gitRepoName,
      gitBranch: handoff.gitBranch,
      gitDirtyFiles: handoff.gitDirtyFiles,
      gitPatch: handoff.gitPatch,
      gitPatchTruncated: handoff.gitPatchTruncated,
      codexModel: handoff.codexModel,
      codexSandboxLevel: handoff.codexSandboxLevel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
      continuationSummary: handoff.continuationSummary,
      createdAt: handoff.createdAt
    };
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: new Date().toISOString(),
      kind: "room.host",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishHostHandoffAccepted(room: RoomRecord, handoff: HostHandoffRecord) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const acceptedAt = new Date().toISOString();
    const payload: HostHandoffPlaintextPayload = {
      id: handoff.id,
      fromHost: handoff.fromHost,
      fromUserId: handoff.fromUserId,
      reason: handoff.reason,
      projectPath: handoff.projectPath,
      gitRemoteUrl: handoff.gitRemoteUrl,
      gitRepoOwner: handoff.gitRepoOwner,
      gitRepoName: handoff.gitRepoName,
      gitBranch: handoff.gitBranch,
      gitDirtyFiles: handoff.gitDirtyFiles,
      gitPatch: handoff.gitPatch,
      gitPatchTruncated: handoff.gitPatchTruncated,
      codexModel: handoff.codexModel,
      codexSandboxLevel: handoff.codexSandboxLevel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
      continuationSummary: handoff.continuationSummary,
      createdAt: handoff.createdAt,
      status: "accepted",
      acceptedBy: localUser.name,
      acceptedByUserId: localUser.id,
      acceptedAt
    };
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: acceptedAt,
      kind: "room.host",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  function markLatestHostHandoffAccepted(roomId: string) {
    markLatestHostHandoffAcceptedForRoom(roomId);
  }

  function markHostHandoffAccepted(roomId: string, handoffId: string) {
    markHostHandoffAcceptedForRoom(roomId, handoffId);
  }

  return {
    setRoomHost,
    acceptHostHandoff,
    publishHostHandoff,
    markHostHandoffAccepted
  };
}

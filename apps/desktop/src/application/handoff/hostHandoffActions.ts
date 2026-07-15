import type {
  CodexSandboxLevel,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  MlsRelayMessage,
  ClientRoomRecord
} from "@multaiplayer/protocol";
import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "../mls/mlsApplicationMessage";
import {
  authorizeMlsHostTransfer,
  markMlsPublishSucceeded,
  mlsGroupState,
  transferMlsHost
} from "../../lib/mls/mlsClient";
import { isStaleMlsPublish } from "../../lib/relay/relayClient";
import { reportExpectedFailure, reportNonFatal } from "../../lib/core/nonFatalReporting";
import { clearAndRebaseStaleMlsCommit } from "../../lib/mls/mlsCommitRebase";
import { applyGitPatch, createGitPatch, getGitRemoteOrigin } from "../../lib/platform/localBackend";
import { updateRoomHost } from "../workspace/workspaceClient";
import { buildCodexTurnSummary } from "../../lib/codex/codexTurn";
import { codexUsageLimitMessage } from "../../lib/codex/codexFailure";
import { findRoomHostHandoff, roomHostHandoffMessage } from "../../lib/handoff/hostHandoff";
import { parseGitHubRemoteUrl } from "../../lib/git/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { roomLockMessage } from "../runtime/appRuntime";
import { createMlsGroupWithHistorySettings } from "../../lib/history/localHistory";
import { queueForHandoff, resolveHandoffProject } from "./hostHandoffProject";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { ChatMessage, HostHandoffRecord } from "../../types";
import type { UseHostHandoffActionsOptions } from "./hostHandoffActionTypes";
import { ensureRoomDefaults } from "../../lib/room/roomDefaults";
import { publishRoomConfigSnapshot } from "../mls/roomConfigSnapshot";
import { publishHostHandoffAccepted } from "./hostHandoffAcceptedPublisher";

export type HostHandoffStateActions = Pick<
  AppStoreState,
  | "markHostHandoffAcceptedForRoom"
  | "markLatestHostHandoffAcceptedForRoom"
  | "markHostHandoffPatchAppliedForRoom"
  | "setCodexContinuationForRoom"
>;

/**
 * Creates the host-transfer application service. React owns only dependency binding;
 * this module owns sequencing native I/O, MLS transitions, relay publication, and UI state updates.
 */
export function createHostHandoffActions(
  {
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    hostGateMessage,
    hostHandoffs,
    queuedCodexTurns,
    localUser,
    deviceId,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    messages,
    terminals,
    browserRequests,
    gitStatus,
    reportRoomHostMutationInFlight,
    replaceRoom,
    setHostBusyForRoom,
    setHostMessageForRoom,
    setSelectedHostMessage,
    resetFileContextForRoom,
    resetCodexApprovalForRoom,
    appendHostHandoff,
    getHostHandoffSnapshot
  }: UseHostHandoffActionsOptions,
  {
    markHostHandoffAcceptedForRoom,
    markLatestHostHandoffAcceptedForRoom,
    markHostHandoffPatchAppliedForRoom,
    setCodexContinuationForRoom
  }: HostHandoffStateActions
) {
  function freshRoom(roomId: string, action: string) {
    const snapshot = getHostHandoffSnapshot();
    if (snapshot.selectedRoomId !== roomId || snapshot.room?.id !== roomId) {
      throw new Error(`${action} stopped because the selected room changed.`);
    }
    return { snapshot, room: snapshot.room };
  }

  function freshHandoff(
    roomId: string,
    handoff: HostHandoffRecord,
    expectedStatuses: HostHandoffRecord["status"][],
    requireActiveHost: boolean
  ) {
    const { snapshot, room } = freshRoom(roomId, "Host handoff");
    if (requireActiveHost && !snapshot.isActiveHost) {
      throw new Error("Host handoff stopped because this device is no longer the active host.");
    }
    const current = snapshot.hostHandoffs.find((candidate) => candidate.id === handoff.id);
    if (!current || !expectedStatuses.includes(current.status)) {
      throw new Error("Host handoff stopped because its state changed.");
    }
    return { snapshot, room, handoff: current };
  }

  function freshRoomHostState(expected: ClientRoomRecord, action: string, requireActiveHost = false) {
    const { snapshot, room } = freshRoom(expected.id, action);
    if (
      room.hostStatus !== expected.hostStatus ||
      room.hostUserId !== expected.hostUserId ||
      room.activeHostDeviceId !== expected.activeHostDeviceId
    ) {
      throw new Error(`${action} stopped because the room host changed.`);
    }
    if (requireActiveHost && !snapshot.isActiveHost) {
      throw new Error(`${action} stopped because this device is no longer the active host.`);
    }
    return { snapshot, room };
  }

  async function publishEncryptedConfig(room: ClientRoomRecord, incrementRevision: boolean) {
    const client = relayRef.current;
    if (!client) throw new Error("Relay is unavailable for the encrypted room configuration snapshot.");
    await publishRoomConfigSnapshot({
      client,
      room,
      senderUserId: localUser.id,
      senderDeviceId: deviceId,
      seenEnvelopeIds: seenEnvelopeIds.current,
      incrementRevision
    });
  }
  async function setRoomHost(hostStatus: ClientRoomRecord["hostStatus"]) {
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
      if (hostStatus === "handoff") {
        await publishHostHandoff(selectedRoom);
        freshRoomHostState(selectedRoom, "Host handoff", true);
        setHostMessageForRoom(roomId, `${selectedRoom.name} is accepting verified host candidates.`);
        return;
      }
      if (hostStatus !== "active")
        throw new Error("MLS host authority can only change through a signed host-transfer Commit.");
      const host = localUser.name;
      const hostUserId = localUser.id;
      if (selectedRoom.acceptedMlsEpoch === undefined) await createMlsGroupWithHistorySettings(roomId);
      freshRoomHostState(selectedRoom, "Host claim");
      const room = ensureRoomDefaults(await updateRoomHost(roomId, host, hostUserId, "active", deviceId), selectedRoom);
      freshRoomHostState(selectedRoom, "Host claim");
      replaceRoom(room);
      await publishEncryptedConfig(room, true);
      freshRoomHostState(room, "Host claim", true);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHostMessageForRoom(roomId, `You are hosting ${room.name}.`);
      }
      markLatestHostHandoffAcceptedForRoom(room.id);
      setCodexContinuationForRoom(room.id, null);
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setHostMessageForRoom(roomId, String(error));
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
    if (handoff.status === "accepted") {
      if (handoff.gitPatch && !handoff.gitPatchTruncated && !handoff.patchAppliedLocally && isActiveHost) {
        await applyAcceptedHostPatch(handoff);
      } else {
        setSelectedHostMessage("This host handoff has already been completed.");
      }
      return;
    }
    const roomHandoff = findRoomHostHandoff(hostHandoffs, handoff.id);
    if (!roomHandoff || (roomHandoff.status !== "available" && !(isActiveHost && roomHandoff.status === "requested"))) {
      setHostMessageForRoom(roomId, roomHostHandoffMessage(hostHandoffs, handoff.id));
      return;
    }
    setHostBusyForRoom(roomId, true);
    setHostMessageForRoom(roomId, null);
    try {
      if (isActiveHost && roomHandoff.status === "requested") await approveHostCandidate(roomHandoff);
      else if (!isActiveHost && roomHandoff.status === "available") await requestHostAuthority(roomHandoff);
      else throw new Error(isActiveHost ? "Wait for a candidate request before approving handoff." : hostGateMessage);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }
  async function applyAcceptedHostPatch(handoff: HostHandoffRecord) {
    const roomId = selectedRoom.id;
    if (reportRoomHostMutationInFlight(roomId)) return;
    setHostBusyForRoom(roomId, true);
    try {
      const project = await resolveHandoffProject(handoff, selectedRoom.projectPath);
      freshHandoff(roomId, handoff, ["accepted"], true);
      const result = await applyGitPatch(project.path, project.path, handoff.gitPatch!);
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git apply failed");
      freshHandoff(roomId, handoff, ["accepted"], true);
      markHostHandoffPatchAppliedForRoom(roomId, handoff.id);
      setCodexContinuationForRoom(
        roomId,
        handoff.reason === "usage_limit" ? { ...handoff, patchAppliedLocally: true } : null
      );
      resetFileContextForRoom(roomId);
      setHostMessageForRoom(roomId, "Applied the reviewed host-handoff patch.");
    } catch (error) {
      setHostMessageForRoom(roomId, `The staged host-handoff patch was not applied: ${String(error)}`);
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }
  async function publishHostHandoff(
    room: ClientRoomRecord,
    reason: HostHandoffRecord["reason"] = "manual",
    contextMessages: ChatMessage[] = messages
  ) {
    const handoff = await prepareHostHandoff(room, reason, contextMessages);
    appendHostHandoff(room.id, handoff);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      setHostMessageForRoom(room.id, "Host handoff package saved locally because the relay is not connected.");
      return;
    }
    const payload: HostHandoffPlaintextPayload = { ...handoff };
    const envelope: MlsRelayMessage = await createMlsApplicationMessage(
      {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "room.host"
      },
      payload
    );
    seenEnvelopeIds.current.add(envelope.id);
    await publishMlsApplicationMessage(client, envelope);
  }

  async function prepareHostHandoff(
    room: ClientRoomRecord,
    reason: HostHandoffRecord["reason"],
    contextMessages: ChatMessage[]
  ): Promise<HostHandoffRecord> {
    const git = await prepareHandoffGitContext(room);
    const summary = buildCodexTurnSummary(contextMessages, room, terminals, git.browserRequests, git.status);
    return {
      id: crypto.randomUUID(),
      fromHost: localUser.name,
      fromUserId: localUser.id,
      reason,
      projectPath: room.projectPath,
      ...handoffGitFields(git),
      ...handoffCodexFields(room),
      messagesSinceLastCodex: summary.messagesSinceLastCodex,
      queuedCodexTurns: queueForHandoff(room.id, queuedCodexTurns),
      attachmentNames: summary.attachments.map((attachment) => attachment.name),
      terminals: summary.terminals,
      continuationSummary: reason === "usage_limit" ? codexUsageLimitMessage(localUser.name) : undefined,
      createdAt: new Date().toISOString(),
      status: "available"
    };
  }

  async function prepareHandoffGitContext(room: ClientRoomRecord) {
    const remoteInfo = await getGitRemoteOrigin(room.projectPath).catch(() => {
      reportExpectedFailure("Git remote was unavailable for host handoff context");
      return { originUrl: null };
    });
    const repoRef = remoteInfo.originUrl ? parseGitHubRemoteUrl(remoteInfo.originUrl) : null;
    const store = useAppStore.getState();
    const roomGitStatus =
      room.id === selectedRoom.id ? gitStatus : (store.gitWorkflowRuntimeByRoom[room.id]?.workflow?.status ?? null);
    const roomBrowserRequests =
      room.id === selectedRoom.id ? browserRequests : (store.browserByRoom[room.id]?.requests ?? []);
    const patchResult = roomGitStatus?.files.length
      ? await createGitPatch(room.projectPath).catch(() => {
          reportExpectedFailure("Git patch was unavailable for host handoff context");
          return null;
        })
      : null;
    return { remoteInfo, repoRef, status: roomGitStatus, patchResult, browserRequests: roomBrowserRequests };
  }

  function handoffGitFields(git: Awaited<ReturnType<typeof prepareHandoffGitContext>>) {
    return {
      ...(git.remoteInfo.originUrl ? { gitRemoteUrl: git.remoteInfo.originUrl } : {}),
      ...(git.repoRef ? { gitRepoOwner: git.repoRef.owner, gitRepoName: git.repoRef.repo } : {}),
      ...(git.status?.branch ? { gitBranch: git.status.branch } : {}),
      ...(git.status?.files.length ? { gitDirtyFiles: git.status.files.slice(0, 50).map((file) => file.path) } : {}),
      ...(git.patchResult?.patch && !git.patchResult.truncated ? { gitPatch: git.patchResult.patch } : {}),
      ...(git.patchResult?.truncated ? { gitPatchTruncated: true } : {})
    };
  }

  function handoffCodexFields(room: ClientRoomRecord) {
    return {
      codexModel: room.codexModel,
      codexModelPolicy: room.codexModelPolicy,
      codexReasoningEffort: room.codexReasoningEffort,
      codexReasoningEffortPolicy: room.codexReasoningEffortPolicy,
      codexRawReasoningEnabled: room.codexRawReasoningEnabled ?? false,
      codexSpeed: room.codexSpeed,
      codexServiceTierPolicy: room.codexServiceTierPolicy,
      codexSandboxLevel: (room.codexSandboxLevel ?? defaultCodexSandboxLevel) as CodexSandboxLevel,
      approvalPolicy: room.approvalPolicy
    };
  }
  async function requestHostAuthority(handoff: HostHandoffRecord) {
    await resolveHandoffProject(handoff, selectedRoom.projectPath);
    freshHandoff(selectedRoom.id, handoff, ["available"], false);
    const group = await mlsGroupState(selectedRoom.id);
    freshHandoff(selectedRoom.id, handoff, ["available"], false);
    const self = group.roster.find((member) => member.leaf === group.selfLeaf);
    if (!self || self.githubUserId !== localUser.id || self.deviceId !== deviceId)
      throw new Error("Local MLS membership does not match this candidate device.");
    const payload: HostHandoffRequestPlaintextPayload = {
      phase: "candidate_request",
      offerId: handoff.id,
      candidateUserId: localUser.id,
      candidateDeviceId: deviceId,
      candidateLeaf: self.leaf
    };
    const message = await createMlsApplicationMessage(
      {
        id: crypto.randomUUID(),
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "room.host.request"
      },
      payload
    );
    freshHandoff(selectedRoom.id, handoff, ["available"], false);
    const relay = relayRef.current;
    if (!relay) throw new Error("Relay is unavailable.");
    seenEnvelopeIds.current.add(message.id);
    await publishMlsApplicationMessage(relay, message).catch((error) => {
      seenEnvelopeIds.current.delete(message.id);
      throw error;
    });
    freshHandoff(selectedRoom.id, handoff, ["available"], false);
    useAppStore.getState().markHostHandoffRequestedForRoom(selectedRoom.id, handoff.id, {
      candidateUserId: localUser.id,
      candidateDeviceId: deviceId,
      candidateLeaf: self.leaf
    });
    setHostMessageForRoom(selectedRoom.id, "Host authority request sent. The active host must explicitly approve it.");
  }
  async function approveHostCandidate(handoff: HostHandoffRecord) {
    if (!handoff.candidateUserId || !handoff.candidateDeviceId || handoff.candidateLeaf === undefined)
      throw new Error("Host candidate identity is incomplete.");
    const group = await mlsGroupState(selectedRoom.id);
    const fresh = freshHandoff(selectedRoom.id, handoff, ["requested"], true).handoff;
    if (
      fresh.candidateUserId !== handoff.candidateUserId ||
      fresh.candidateDeviceId !== handoff.candidateDeviceId ||
      fresh.candidateLeaf !== handoff.candidateLeaf
    )
      throw new Error("Host handoff stopped because the candidate request changed.");
    const candidate = group.roster.find((member) => member.leaf === handoff.candidateLeaf);
    if (
      !candidate ||
      candidate.githubUserId !== handoff.candidateUserId ||
      candidate.deviceId !== handoff.candidateDeviceId
    )
      throw new Error("Host candidate no longer matches the authenticated MLS roster leaf.");
    freshHandoff(selectedRoom.id, handoff, ["requested"], true);
    const commit = await transferMlsHost(selectedRoom.id, candidate.leaf, candidate.deviceId, handoff.id);
    freshHandoff(selectedRoom.id, handoff, ["requested"], true);
    const signed = await authorizeMlsHostTransfer(selectedRoom.id, commit.outboxId);
    freshHandoff(selectedRoom.id, handoff, ["requested"], true);
    const message: MlsRelayMessage = {
      id: commit.outboxId,
      teamId: selectedRoom.teamId,
      roomId: selectedRoom.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: new Date().toISOString(),
      messageType: "commit",
      epochHint: commit.parentEpoch,
      mlsMessage: commit.message,
      commitEffect: "host_handoff",
      nextHostUserId: candidate.githubUserId,
      nextHostDeviceId: candidate.deviceId,
      hostTransferAuthorization: {
        ...signed.authorization,
        signatureDer: signed.signatureDer,
        publicKeySpkiDer: signed.publicKeySpkiDer
      }
    };
    const relay = relayRef.current;
    if (!relay) throw new Error("Relay is unavailable.");
    seenEnvelopeIds.current.add(message.id);
    try {
      await relay.publishAndWaitForAck({ type: "publish", message });
    } catch (error) {
      seenEnvelopeIds.current.delete(message.id);
      if (isStaleMlsPublish(error)) {
        const token = useAppStore.getState().deviceSessionToken;
        if (!token) throw new Error("Device session expired before MLS stale-epoch rebase.");
        await clearAndRebaseStaleMlsCommit(
          relay,
          selectedRoom,
          { userId: localUser.id, deviceId, deviceSessionToken: token },
          commit.outboxId,
          commit.parentEpoch
        );
      }
      throw error;
    }
    freshHandoff(selectedRoom.id, handoff, ["requested"], false);
    const committedEpoch = await markMlsPublishSucceeded(selectedRoom.id, commit.outboxId);
    freshHandoff(selectedRoom.id, handoff, ["requested"], false);
    markHostHandoffAcceptedForRoom(selectedRoom.id, handoff.id);
    try {
      await publishHostHandoffAccepted({
        room: selectedRoom,
        handoff,
        hostLeaf: candidate.leaf,
        committedEpoch,
        localUserId: localUser.id,
        deviceId,
        relayStatus,
        relayRef,
        seenEnvelopeIds
      });
    } catch (error) {
      reportNonFatal("publish the informational host handoff acceptance event", error);
    }
  }
  return {
    setRoomHost,
    acceptHostHandoff,
    publishHostHandoff,
    markHostHandoffAccepted: markHostHandoffAcceptedForRoom
  };
}

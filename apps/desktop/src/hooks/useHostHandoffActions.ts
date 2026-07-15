import type {
  CodexSandboxLevel,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  MlsRelayMessage,
  ClientRoomRecord
} from "@multaiplayer/protocol";
import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "../lib/mlsApplicationMessage";
import { authorizeMlsHostTransfer, markMlsPublishSucceeded, mlsGroupState, transferMlsHost } from "../lib/mlsClient";
import { isStaleMlsPublish } from "../lib/relayClient";
import { reportExpectedFailure } from "../lib/nonFatalReporting";
import { clearAndRebaseStaleMlsCommit } from "../lib/mlsCommitRebase";
import { createGitPatch, getGitRemoteOrigin } from "../lib/localBackend";
import { updateRoomHost } from "../lib/workspaceClient";
import { buildCodexTurnSummary } from "../lib/codexTurn";
import { codexUsageLimitMessage } from "../lib/codexFailure";
import { createHandoffSettingsPatch, findRoomHostHandoff, roomHostHandoffMessage } from "../lib/hostHandoff";
import { parseGitHubRemoteUrl } from "../lib/gitWorkflowDraft";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { roomLockMessage } from "../lib/appRuntime";
import { createMlsGroupWithHistorySettings } from "../lib/localHistory";
import { queueForHandoff, resolveHandoffProject } from "./hostHandoffHelpers";
import { useAppStore } from "../store/appStore";
import type { ChatMessage, HostHandoffRecord } from "../types";
import type { UseHostHandoffActionsOptions } from "./hostHandoffActionTypes";
import { useFinalizeIncomingHostHandoff } from "./useFinalizeIncomingHostHandoff";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { publishRoomConfigSnapshot } from "../lib/roomConfigSnapshot";
import { publishHostHandoffAccepted } from "../lib/hostHandoffAcceptedPublisher";
export function useHostHandoffActions({
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
  useFinalizeIncomingHostHandoff({
    room: selectedRoom,
    handoffs: hostHandoffs,
    localUserId: localUser.id,
    deviceId,
    roomSettingsActor,
    replaceRoom,
    setHostMessage: setHostMessageForRoom,
    setSettingsMessage: setSettingsMessageForRoom,
    setProjectPathDraft: setProjectPathDraftForRoom,
    setCustomCodexModel: setCustomCodexModelForRoom,
    resetFileContext: resetFileContextForRoom,
    resetCodexApproval: resetCodexApprovalForRoom,
    publishConfig: (room) => publishEncryptedConfig(room, true)
  });
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
        setHostMessageForRoom(roomId, `${selectedRoom.name} is accepting verified host candidates.`);
        return;
      }
      if (hostStatus !== "active")
        throw new Error("MLS host authority can only change through a signed host-transfer Commit.");
      const host = localUser.name;
      const hostUserId = localUser.id;
      if (selectedRoom.acceptedMlsEpoch === undefined) await createMlsGroupWithHistorySettings(roomId);
      const room = ensureRoomDefaults(await updateRoomHost(roomId, host, hostUserId, "active", deviceId), selectedRoom);
      replaceRoom(room);
      await publishEncryptedConfig(room, true);
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
      setSelectedHostMessage("This host handoff has already been completed.");
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
  async function publishHostHandoff(
    room: ClientRoomRecord,
    reason: HostHandoffRecord["reason"] = "manual",
    contextMessages: ChatMessage[] = messages
  ) {
    const remoteInfo = await getGitRemoteOrigin(room.projectPath).catch(() => {
      reportExpectedFailure("Git remote was unavailable for host handoff context");
      return { originUrl: null };
    });
    const repoRef = remoteInfo.originUrl ? parseGitHubRemoteUrl(remoteInfo.originUrl) : null;
    const roomGitStatus = room.id === selectedRoom.id ? gitStatus : (gitStatusByRoom[room.id] ?? null);
    const patchResult = roomGitStatus?.files.length
      ? await createGitPatch(room.projectPath).catch(() => {
          reportExpectedFailure("Git patch was unavailable for host handoff context");
          return null;
        })
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
      ...(roomGitStatus?.files.length
        ? { gitDirtyFiles: roomGitStatus.files.slice(0, 50).map((file) => file.path) }
        : {}),
      ...(patchResult?.patch && !patchResult.truncated ? { gitPatch: patchResult.patch } : {}),
      ...(patchResult?.truncated ? { gitPatchTruncated: true } : {}),
      codexModel: room.codexModel,
      codexModelPolicy: room.codexModelPolicy,
      codexReasoningEffort: room.codexReasoningEffort,
      codexReasoningEffortPolicy: room.codexReasoningEffortPolicy,
      codexRawReasoningEnabled: room.codexRawReasoningEnabled ?? false,
      codexSpeed: room.codexSpeed,
      codexServiceTierPolicy: room.codexServiceTierPolicy,
      codexSandboxLevel: (room.codexSandboxLevel ?? defaultCodexSandboxLevel) as CodexSandboxLevel,
      approvalPolicy: room.approvalPolicy,
      messagesSinceLastCodex: summary.messagesSinceLastCodex,
      queuedCodexTurns: queueForHandoff(room.id, queuedCodexTurns),
      attachmentNames: summary.attachments.map((attachment) => attachment.name),
      terminals: summary.terminals,
      continuationSummary: reason === "usage_limit" ? codexUsageLimitMessage(localUser.name) : undefined,
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
      codexModelPolicy: handoff.codexModelPolicy,
      codexReasoningEffort: handoff.codexReasoningEffort,
      codexReasoningEffortPolicy: handoff.codexReasoningEffortPolicy,
      codexRawReasoningEnabled: handoff.codexRawReasoningEnabled,
      codexSpeed: handoff.codexSpeed,
      codexServiceTierPolicy: handoff.codexServiceTierPolicy,
      codexSandboxLevel: handoff.codexSandboxLevel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      queuedCodexTurns: handoff.queuedCodexTurns,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
      continuationSummary: handoff.continuationSummary,
      createdAt: handoff.createdAt
    };
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
  async function requestHostAuthority(handoff: HostHandoffRecord) {
    const patch = createHandoffSettingsPatch(handoff);
    await resolveHandoffProject(handoff, patch.projectPath);
    const group = await mlsGroupState(selectedRoom.id);
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
    const relay = relayRef.current;
    if (!relay) throw new Error("Relay is unavailable.");
    seenEnvelopeIds.current.add(message.id);
    await publishMlsApplicationMessage(relay, message).catch((error) => {
      seenEnvelopeIds.current.delete(message.id);
      throw error;
    });
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
    const candidate = group.roster.find((member) => member.leaf === handoff.candidateLeaf);
    if (
      !candidate ||
      candidate.githubUserId !== handoff.candidateUserId ||
      candidate.deviceId !== handoff.candidateDeviceId
    )
      throw new Error("Host candidate no longer matches the authenticated MLS roster leaf.");
    const commit = await transferMlsHost(selectedRoom.id, candidate.leaf, candidate.deviceId);
    const signed = await authorizeMlsHostTransfer(selectedRoom.id, commit.outboxId);
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
    const committedEpoch = await markMlsPublishSucceeded(selectedRoom.id, commit.outboxId);
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
    markHostHandoffAcceptedForRoom(selectedRoom.id, handoff.id);
  }
  return {
    setRoomHost,
    acceptHostHandoff,
    publishHostHandoff,
    markHostHandoffAccepted: markHostHandoffAcceptedForRoom
  };
}

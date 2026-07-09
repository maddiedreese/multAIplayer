import type { MutableRefObject } from "react";
import type {
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  RelayEnvelope,
  RequestStatusPlaintextPayload,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  TerminalResultPlaintextPayload
} from "@multaiplayer/protocol";
import { encryptJson } from "@multaiplayer/crypto";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import type { RelayClient } from "../lib/relayClient";
import { buildRoomSettingsSystemMessage } from "../lib/roomSettingsMessages";
import { buildCodexEventLine } from "../lib/activityLines";
import type {
  ChatMessage,
  CodexRoomEvent,
  LocalPreviewRecord,
  RelayStatus,
  TerminalCommandRequest
} from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseRelayPublishersOptions {
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  relayStatus: RelayStatus;
  selectedRoom: RoomRecord;
  deviceId: string;
  localUser: LocalUser;
  approvalPolicyLabels: Record<string, string>;
  approvalDelegationPolicyLabels: Record<string, string>;
  roomModeLabels: Record<string, string>;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
}

export function useRelayPublishers({
  relayRef,
  seenEnvelopeIds,
  relayStatus,
  selectedRoom,
  deviceId,
  localUser,
  approvalPolicyLabels,
  approvalDelegationPolicyLabels,
  roomModeLabels,
  appendLocalPreviewEvent,
  appendGitWorkflowEvent,
  appendCodexEvent,
  appendTerminalLinesForRoom,
  appendRoomMessage,
  appendGitHubActionsEvent
}: UseRelayPublishersOptions) {
  function buildLocalRequestStatusPayload(
    requestId: string,
    status: RequestStatusPlaintextPayload["status"]
  ): RequestStatusPlaintextPayload {
    return {
      requestId,
      status,
      decidedBy: localUser.name,
      decidedByUserId: localUser.id,
      decidedAt: new Date().toISOString()
    };
  }

  async function publishEnvelope(envelope: RelayEnvelope) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishRequestStatus(
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: RequestStatusPlaintextPayload["status"],
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload = buildLocalRequestStatusPayload(requestId, status);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.decidedAt,
      kind,
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishLocalPreviewEvent(payload: LocalPreviewRecord, room: RoomRecord = selectedRoom) {
    appendLocalPreviewEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.updatedAt,
      kind: "preview.event",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishTerminalResult(
    request: TerminalCommandRequest,
    result: {
      startedAt: string;
      finishedAt: string;
      exitStatus: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    },
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload: TerminalResultPlaintextPayload = {
      eventType: "terminal.result",
      requestId: request.id,
      command: request.command,
      cwd: request.cwd,
      exitStatus: result.exitStatus,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
      ranBy: localUser.name,
      ranByUserId: localUser.id,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt
    };
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.finishedAt,
      kind: "terminal.event",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishGitWorkflowEvent(
    event: Omit<GitWorkflowEventPlaintextPayload, "eventType" | "runner" | "runnerUserId" | "createdAt">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: GitWorkflowEventPlaintextPayload = {
      eventType: "git.workflow",
      runner: localUser.name,
      runnerUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };
    appendGitWorkflowEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "git.event",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishCodexEvent(
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: CodexEventPlaintextPayload = {
      eventType: "codex.turn",
      host: localUser.name,
      hostUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };
    appendCodexEvent(room.id, payload);
    appendTerminalLinesForRoom(room.id, [buildCodexEventLine(payload)]);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "codex.event",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishCodexQueueEvent(
    event: Omit<CodexQueuePlaintextPayload, "eventType" | "queueEventId" | "requestedBy" | "requestedByUserId" | "createdAt">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: CodexQueuePlaintextPayload = {
      eventType: "codex.queue",
      queueEventId: crypto.randomUUID(),
      requestedBy: localUser.name,
      requestedByUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "codex.queue",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishRoomSettingsEvent(
    room: RoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) {
    const payload: RoomSettingsPlaintextPayload = {
      eventType: "room.settings",
      changedBy: localUser.name,
      changedByUserId: localUser.id,
      ...event
    };
    appendRoomMessage(room.id, buildRoomSettingsSystemMessage(payload, {
      approvalPolicyLabels,
      approvalDelegationPolicyLabels,
      roomModeLabels
    }));

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.changedAt,
      kind: "room.settings",
      payload: await encryptJson(payload, secret)
    });
  }

  async function publishGitHubActionsEvent(
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: GitHubActionsEventPlaintextPayload = {
      eventType: "github.actions",
      checkedBy: localUser.name,
      checkedByUserId: localUser.id,
      ...event
    };
    appendGitHubActionsEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope({
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.checkedAt,
      kind: "git.event",
      payload: await encryptJson(payload, secret)
    });
  }

  return {
    publishRequestStatus,
    publishLocalPreviewEvent,
    publishTerminalResult,
    publishGitWorkflowEvent,
    publishCodexEvent,
    publishCodexQueueEvent,
    publishRoomSettingsEvent,
    publishGitHubActionsEvent
  };
}

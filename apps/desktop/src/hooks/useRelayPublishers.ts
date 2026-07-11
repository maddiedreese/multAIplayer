import type { MutableRefObject } from "react";
import type {
  CodexEventPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexQueuePlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  RelayEnvelope,
  RequestStatusPlaintextPayload,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  TerminalResultPlaintextPayload
} from "@multaiplayer/protocol";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import { createEncryptedRoomEnvelope, roomKeyEpoch } from "../lib/encryptedEnvelope";
import type { RelayClient } from "../lib/relayClient";
import { buildRoomSettingsSystemMessage } from "../lib/roomSettingsMessages";
import { buildCodexEventLine } from "../lib/activityLines";
import type {
  ChatMessage,
  CodexRoomEvent,
  CodexActivity,
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
  upsertCodexActivity: (roomId: string, activity: CodexActivity) => void;
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
  upsertCodexActivity,
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

  async function publishPlaintext(room: RoomRecord, kind: RelayEnvelope["kind"], createdAt: string, payload: unknown) {
    const secret = await loadOrCreateRoomSecret(room.id);
    await publishEnvelope(
      await createEncryptedRoomEnvelope(
        {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: deviceId,
          senderUserId: localUser.id,
          createdAt,
          kind,
          keyEpoch: roomKeyEpoch(room)
        },
        payload,
        secret
      )
    );
  }

  async function publishRequestStatus(
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: RequestStatusPlaintextPayload["status"],
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const payload = buildLocalRequestStatusPayload(requestId, status);
    await publishPlaintext(room, kind, payload.decidedAt, payload);
  }

  async function publishLocalPreviewEvent(payload: LocalPreviewRecord, room: RoomRecord = selectedRoom) {
    appendLocalPreviewEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    await publishPlaintext(room, "preview.event", payload.updatedAt, payload);
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
    await publishPlaintext(room, "terminal.event", payload.finishedAt, payload);
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
    await publishPlaintext(room, "git.event", payload.createdAt, payload);
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
    await publishPlaintext(room, "codex.event", payload.createdAt, payload);
  }

  async function publishCodexActivity(
    event: Omit<CodexActivityPlaintextPayload, "eventType" | "host" | "hostUserId">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: CodexActivityPlaintextPayload = {
      eventType: "codex.activity",
      host: localUser.name,
      hostUserId: localUser.id,
      ...event
    };
    upsertCodexActivity(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    await publishPlaintext(room, "codex.activity", payload.updatedAt, payload);
  }

  async function publishCodexQueueEvent(
    event: Omit<
      CodexQueuePlaintextPayload,
      "eventType" | "queueEventId" | "requestedBy" | "requestedByUserId" | "createdAt"
    >,
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
    await publishPlaintext(room, "codex.queue", payload.createdAt, payload);
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
    appendRoomMessage(
      room.id,
      buildRoomSettingsSystemMessage(payload, {
        approvalPolicyLabels,
        approvalDelegationPolicyLabels,
        roomModeLabels
      })
    );

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    await publishPlaintext(room, "room.settings", payload.changedAt, payload);
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
    await publishPlaintext(room, "git.event", payload.checkedAt, payload);
  }

  return {
    publishRequestStatus,
    publishLocalPreviewEvent,
    publishTerminalResult,
    publishGitWorkflowEvent,
    publishCodexEvent,
    publishCodexActivity,
    publishCodexQueueEvent,
    publishRoomSettingsEvent,
    publishGitHubActionsEvent
  };
}

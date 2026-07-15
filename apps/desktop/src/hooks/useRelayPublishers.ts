import type { MutableRefObject } from "react";
import type {
  CodexEventPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexQueuePlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  MlsRelayMessage,
  RequestStatusPlaintextPayload,
  ClientRoomRecord,
  RoomSettingsPlaintextPayload,
  TerminalResultPlaintextPayload
} from "@multaiplayer/protocol";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "../application/mls/mlsApplicationMessage";
import type { RelayClient } from "../lib/relay/relayClient";
import { buildRoomSettingsSystemMessage } from "../presentation/rooms/roomSettingsMessages";
import { buildCodexEventLine } from "../presentation/activity/activityLines";
import { publishRoomConfigSnapshot } from "../application/mls/roomConfigSnapshot";
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
  selectedRoom: ClientRoomRecord;
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

  async function publishMlsMessage(envelope: MlsRelayMessage) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    seenEnvelopeIds.current.add(envelope.id);
    await publishMlsApplicationMessage(client, envelope);
  }

  async function publishPlaintext(room: ClientRoomRecord, kind: string, createdAt: string, payload: unknown) {
    await publishMlsMessage(
      await createMlsApplicationMessage(
        {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: deviceId,
          senderUserId: localUser.id,
          createdAt,
          kind
        },
        payload
      )
    );
  }

  async function publishRequestStatus(
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: RequestStatusPlaintextPayload["status"],
    room: ClientRoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const payload = buildLocalRequestStatusPayload(requestId, status);
    await publishPlaintext(room, kind, payload.decidedAt, payload);
  }

  async function publishLocalPreviewEvent(payload: LocalPreviewRecord, room: ClientRoomRecord = selectedRoom) {
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
    room: ClientRoomRecord = selectedRoom
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
    room: ClientRoomRecord = selectedRoom
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
    room: ClientRoomRecord = selectedRoom
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
    room: ClientRoomRecord = selectedRoom
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
    room: ClientRoomRecord = selectedRoom
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
    room: ClientRoomRecord,
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
    await publishRoomConfigSnapshot({
      client,
      room,
      senderUserId: localUser.id,
      senderDeviceId: deviceId,
      seenEnvelopeIds: seenEnvelopeIds.current
    });
  }

  async function publishGitHubActionsEvent(
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room: ClientRoomRecord = selectedRoom
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

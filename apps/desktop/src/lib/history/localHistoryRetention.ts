import { maxCodexActivitiesPerRoom } from "@multaiplayer/protocol";
import type { LocalRoomHistoryPayload } from "../../types";
import { normalizeCodexThreadGraph } from "../codex/codexThreadGraph";
import { terminalsForLocalHistory } from "../terminal/terminalState";

export const maxLocalHistoryItemsPerContainer = 10_000;

export function pruneLocalRoomHistory(
  payload: LocalRoomHistoryPayload,
  retentionDays: number
): LocalRoomHistoryPayload {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    version: 3,
    messages: retainNewest(
      payload.messages.filter((message) => isWithinRetention(message.createdAt ?? message.time, cutoffMs))
    ),
    chatEdits: retainNewest(payload.chatEdits.filter((edit) => isWithinRetention(edit.editedAt, cutoffMs))),
    chatDeletes: retainNewest(
      payload.chatDeletes.filter((deletion) => isWithinRetention(deletion.deletedAt, cutoffMs))
    ),
    readState: payload.readState,
    terminalRequests: retainNewest(
      payload.terminalRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs))
    ),
    fileSaveRequests: retainNewest(
      (payload.fileSaveRequests ?? []).filter((request) => isWithinRetention(request.requestedAt, cutoffMs))
    ),
    browserRequests: retainNewest(
      payload.browserRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs))
    ),
    inviteRequests: retainNewest(
      payload.inviteRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs))
    ),
    codexEvents: retainNewest(payload.codexEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs))),
    codexActivities: payload.codexActivities
      .filter((activity) => isWithinRetention(activity.updatedAt, cutoffMs))
      .slice(-maxCodexActivitiesPerRoom),
    gitWorkflowEvents: retainNewest(
      payload.gitWorkflowEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs))
    ),
    githubActionsEvents: retainNewest(
      payload.githubActionsEvents.filter((event) => isWithinRetention(event.checkedAt, cutoffMs))
    ),
    localPreviews: retainNewest(
      payload.localPreviews.filter((preview) => isWithinRetention(preview.updatedAt, cutoffMs))
    ),
    terminalSnapshots: retainNewest(
      terminalsForLocalHistory(
        payload.terminalSnapshots.filter((terminal) => isWithinRetention(terminal.startedAt, cutoffMs))
      )
    ),
    hostHandoffs: retainNewest(
      payload.hostHandoffs.filter((handoff) => isWithinRetention(handoff.createdAt, cutoffMs))
    ),
    queuedCodexTurns: retainNewest(
      payload.queuedCodexTurns.filter((turn) => isWithinRetention(turn.queuedAt, cutoffMs))
    ),
    ...(payload.roomGoal && isWithinRetention(payload.roomGoal.updatedAt, cutoffMs)
      ? { roomGoal: payload.roomGoal }
      : {}),
    ...(payload.codexThreadGraph?.activeThreadId
      ? { codexThreadGraph: normalizeCodexThreadGraph(payload.codexThreadGraph) }
      : {})
  };
}

function retainNewest<T>(items: T[]): T[] {
  return items.length > maxLocalHistoryItemsPerContainer ? items.slice(-maxLocalHistoryItemsPerContainer) : items;
}

function isWithinRetention(value: string | undefined, cutoffMs: number): boolean {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || timestamp >= cutoffMs;
}

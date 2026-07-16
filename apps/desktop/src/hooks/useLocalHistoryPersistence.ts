import { useEffect, useRef } from "react";
import { queueEncryptedHistorySave, type LocalHistorySettings } from "../lib/history/localHistory";
import {
  clearMatchingHistoryMessage,
  historySaveFailureMessage,
  localHistoryPayloadForRoom,
  markHistorySaveFailure
} from "../application/history/localHistorySnapshot";
import { reportNonFatal } from "../lib/core/nonFatalReporting";
import type { TerminalSnapshot } from "../lib/platform/localBackend";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  CodexActivity,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  QueuedCodexTurn,
  RoomGoal,
  CodexThreadGraph,
  TerminalCommandRequest,
  WorkspaceFileSaveRequest
} from "../types";
import type {
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";

interface UseLocalHistoryPersistenceOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomTeamId: string;
  selectedRoom: ClientRoomRecord;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  historySettings: LocalHistorySettings;
  messages: ChatMessage[];
  chatEdits: ChatEditPlaintextPayload[];
  chatDeletes: ChatDeletePlaintextPayload[];
  terminalRequests: TerminalCommandRequest[];
  fileSaveRequests: WorkspaceFileSaveRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  codexActivities: CodexActivity[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  localPreviews: LocalPreviewRecord[];
  terminals: TerminalSnapshot[];
  hostHandoffs: HostHandoffRecord[];
  queuedCodexTurns: QueuedCodexTurn[];
  roomGoal: RoomGoal | null;
  codexThreadGraph: CodexThreadGraph;
}

export function useLocalHistoryPersistence({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomTeamId,
  selectedRoom,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  historySettings,
  messages,
  chatEdits,
  chatDeletes,
  terminalRequests,
  fileSaveRequests,
  browserRequests,
  inviteRequests,
  codexEvents,
  codexActivities,
  gitWorkflowEvents,
  githubActionsEvents,
  localPreviews,
  terminals,
  hostHandoffs,
  queuedCodexTurns,
  roomGoal,
  codexThreadGraph
}: UseLocalHistoryPersistenceOptions) {
  const hydrationStatus = useAppStore((state) => state.historyPresenceByRoom[selectedRoomId]?.historyHydrationStatus);
  const persistenceEnabledRoomIds = useRef(new Set<string>());
  useEffect(() => {
    if (hydrationStatus !== "ready") {
      persistenceEnabledRoomIds.current.delete(selectedRoomId);
      return;
    }
    // Hydration completion unlocks later persistence but is not itself a data
    // mutation. Avoid an unnecessary native MLS exporter operation while room
    // reconnect and durable invite/backlog replay are still settling.
    if (!persistenceEnabledRoomIds.current.has(selectedRoomId)) {
      persistenceEnabledRoomIds.current.add(selectedRoomId);
      return;
    }
    if (!hasSelectedRoom) return;
    if (
      forgottenRoomIds.has(selectedRoomId) ||
      revokedRoomIds.has(selectedRoomId) ||
      revokedTeamIds.has(selectedRoomTeamId)
    )
      return;
    const payload = localHistoryPayloadForRoom(useAppStore.getState(), selectedRoomId, historySettings.retentionDays);
    queueEncryptedHistorySave(
      selectedRoomId,
      payload,
      (error) => {
        reportNonFatal("save encrypted local history", error);
        markHistorySaveFailure(selectedRoomId, error);
      },
      () => clearMatchingHistoryMessage(selectedRoomId, historySaveFailureMessage)
    );
  }, [
    browserRequests,
    fileSaveRequests,
    historySettings.enabled,
    historySettings.retentionDays,
    hydrationStatus,
    hostHandoffs,
    queuedCodexTurns,
    roomGoal,
    inviteRequests,
    codexEvents,
    codexActivities,
    gitWorkflowEvents,
    githubActionsEvents,
    localPreviews,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    terminals,
    chatEdits,
    chatDeletes,
    messages,
    hasSelectedRoom,
    codexThreadGraph,
    selectedRoomId,
    selectedRoomTeamId,
    selectedRoom,
    terminalRequests
  ]);
}

import { useEffect } from "react";
import type { LocalHistorySettings } from "../lib/history/localHistory";
import { queueEncryptedHistorySave } from "../lib/history/localHistoryWriteQueue";
import { pruneLocalRoomHistory } from "../lib/history/localRoomHistoryPayload";
import { localRoomReadStateForHistory } from "../lib/history/roomUnread";
import { reportNonFatal } from "../lib/core/nonFatalReporting";
import { terminalsForLocalHistory } from "../lib/terminal/terminalState";
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
  LocalRoomHistoryPayload,
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
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (
      forgottenRoomIds.has(selectedRoomId) ||
      revokedRoomIds.has(selectedRoomId) ||
      revokedTeamIds.has(selectedRoomTeamId)
    )
      return;
    if (hydrationStatus !== "ready") return;
    const payload = pruneLocalRoomHistory(
      {
        version: 3,
        messages,
        chatEdits,
        chatDeletes,
        readState: localRoomReadStateForHistory(selectedRoom, messages),
        terminalRequests,
        fileSaveRequests,
        browserRequests,
        inviteRequests,
        codexEvents,
        codexActivities,
        gitWorkflowEvents,
        githubActionsEvents,
        localPreviews,
        terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === selectedRoomId)),
        hostHandoffs,
        queuedCodexTurns,
        ...(roomGoal ? { roomGoal } : {}),
        ...(codexThreadGraph.activeThreadId ? { codexThreadGraph } : {})
      },
      historySettings.retentionDays
    );
    queueEncryptedHistorySave(selectedRoomId, payload satisfies LocalRoomHistoryPayload, (error) => {
      reportNonFatal("save encrypted local history", error);
      useAppStore
        .getState()
        .setHistoryMessageForRoom(
          selectedRoomId,
          "Encrypted local history could not be saved. New history will be retried after the next change."
        );
    });
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

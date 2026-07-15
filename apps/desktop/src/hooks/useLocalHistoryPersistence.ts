import { useEffect } from "react";
import { saveEncryptedHistory, type LocalHistorySettings } from "../lib/history/localHistory";
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

interface LatestRef<T> {
  current: T;
}

interface UseLocalHistoryPersistenceOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomTeamId: string;
  selectedRoom: ClientRoomRecord;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  historyLoadedRoomIds: LatestRef<Set<string>>;
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
  historyLoadedRoomIds,
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
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (
      forgottenRoomIds.has(selectedRoomId) ||
      revokedRoomIds.has(selectedRoomId) ||
      revokedTeamIds.has(selectedRoomTeamId)
    )
      return;
    if (!historyLoadedRoomIds.current.has(selectedRoomId)) return;
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
    saveEncryptedHistory(selectedRoomId, payload satisfies LocalRoomHistoryPayload).catch((error) => {
      reportNonFatal("save encrypted local history", error);
    });
  }, [
    browserRequests,
    fileSaveRequests,
    historySettings.enabled,
    historySettings.retentionDays,
    historyLoadedRoomIds,
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

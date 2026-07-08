import { useEffect } from "react";
import { saveEncryptedHistory, type LocalHistorySettings } from "../lib/localHistory";
import { pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { localRoomReadStateForHistory } from "../lib/roomUnread";
import { terminalsForLocalHistory } from "../lib/terminalState";
import type { TerminalSnapshot } from "../lib/localBackend";
import type { RoomRecord } from "@multaiplayer/protocol";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  LocalRoomHistoryPayload,
  TerminalCommandRequest
} from "../types";
import type {
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
  selectedRoom: RoomRecord;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  historyLoadedRoomIds: LatestRef<Set<string>>;
  historySettings: LocalHistorySettings;
  messages: ChatMessage[];
  terminalRequests: TerminalCommandRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  localPreviews: LocalPreviewRecord[];
  terminals: TerminalSnapshot[];
  hostHandoffs: HostHandoffRecord[];
  selectedCodexThreadId: string | null;
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
  terminalRequests,
  browserRequests,
  inviteRequests,
  codexEvents,
  gitWorkflowEvents,
  githubActionsEvents,
  localPreviews,
  terminals,
  hostHandoffs,
  selectedCodexThreadId
}: UseLocalHistoryPersistenceOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId) || revokedRoomIds.has(selectedRoomId) || revokedTeamIds.has(selectedRoomTeamId)) return;
    if (!historyLoadedRoomIds.current.has(selectedRoomId)) return;
    const payload = pruneLocalRoomHistory({
      version: 3,
      messages,
      readState: localRoomReadStateForHistory(selectedRoom, messages),
      terminalRequests,
      browserRequests,
      inviteRequests,
      codexEvents,
      gitWorkflowEvents,
      githubActionsEvents,
      localPreviews,
      terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === selectedRoomId)),
      hostHandoffs,
      ...(selectedCodexThreadId ? { codexThreadId: selectedCodexThreadId } : {})
    }, historySettings.retentionDays);
    saveEncryptedHistory(selectedRoomId, payload satisfies LocalRoomHistoryPayload).catch((error) => {
      console.warn("Failed to save encrypted local history", error);
    });
  }, [
    browserRequests,
    historySettings.enabled,
    historySettings.retentionDays,
    hostHandoffs,
    inviteRequests,
    codexEvents,
    gitWorkflowEvents,
    githubActionsEvents,
    localPreviews,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    terminals,
    messages,
    hasSelectedRoom,
    selectedCodexThreadId,
    selectedRoomId,
    selectedRoomTeamId,
    selectedRoom,
    terminalRequests
  ]);
}

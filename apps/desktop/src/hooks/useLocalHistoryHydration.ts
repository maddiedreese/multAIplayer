import { useEffect, type Dispatch, type SetStateAction } from "react";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import {
  hasHistorySettings,
  loadEncryptedHistory,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../lib/localHistory";
import { normalizeLocalRoomHistory, pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { replaceRoomTerminalSnapshots } from "../lib/terminalState";
import { normalizeCodexThreadId } from "../lib/codexThread";
import type { GitHubActionRun } from "../lib/authClient";
import type { TerminalSnapshot } from "../lib/localBackend";
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

interface LatestRef<T> {
  current: T;
}

interface UseLocalHistoryHydrationOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomTeamId: string;
  forgottenRoomIds: Set<string>;
  historyLoadedRoomIds: LatestRef<Set<string>>;
  setHistorySettings: Dispatch<SetStateAction<LocalHistorySettings>>;
  setMessagesByRoom: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setTerminalRequestsByRoom: Dispatch<SetStateAction<Record<string, TerminalCommandRequest[]>>>;
  setBrowserRequestsByRoom: Dispatch<SetStateAction<Record<string, BrowserAccessRequest[]>>>;
  setInviteRequestsByRoom: Dispatch<SetStateAction<Record<string, InviteJoinRequest[]>>>;
  setCodexEventsByRoom: Dispatch<SetStateAction<Record<string, CodexRoomEvent[]>>>;
  setGitWorkflowEventsByRoom: Dispatch<SetStateAction<Record<string, GitWorkflowEventPlaintextPayload[]>>>;
  setGitHubActionsEventsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionsEventPlaintextPayload[]>>>;
  setLocalPreviewsByRoom: Dispatch<SetStateAction<Record<string, LocalPreviewRecord[]>>>;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setActionRunsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionRun[]>>>;
  setActionsLastCheckedByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTerminals: Dispatch<SetStateAction<TerminalSnapshot[]>>;
  setSelectedTerminalIdsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setHostHandoffsByRoom: Dispatch<SetStateAction<Record<string, HostHandoffRecord[]>>>;
  setCodexThreadIdsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useLocalHistoryHydration({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomTeamId,
  forgottenRoomIds,
  historyLoadedRoomIds,
  setHistorySettings,
  setMessagesByRoom,
  setTerminalRequestsByRoom,
  setBrowserRequestsByRoom,
  setInviteRequestsByRoom,
  setCodexEventsByRoom,
  setGitWorkflowEventsByRoom,
  setGitHubActionsEventsByRoom,
  setLocalPreviewsByRoom,
  setGitWorkflowMessageForRoom,
  setActionRunsByRoom,
  setActionsLastCheckedByRoom,
  setActionsMessagesByRoom,
  setTerminals,
  setSelectedTerminalIdsByRoom,
  setHostHandoffsByRoom,
  setCodexThreadIdsByRoom
}: UseLocalHistoryHydrationOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId)) {
      setHistorySettings(loadHistorySettings(selectedRoomId));
      return;
    }
    let cancelled = false;
    const settings = hasHistorySettings(selectedRoomId)
      ? loadHistorySettings(selectedRoomId)
      : loadTeamHistorySettings(selectedRoomTeamId);
    if (!hasHistorySettings(selectedRoomId)) {
      saveHistorySettings(selectedRoomId, settings);
    }
    setHistorySettings(settings);
    loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(selectedRoomId).then((storedHistory) => {
      if (cancelled || !storedHistory) return;
      const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
      if (payload.messages.length) {
        setMessagesByRoom((current) => ({
          ...current,
          [selectedRoomId]: payload.messages
        }));
      }
      setTerminalRequestsByRoom((current) =>
        payload.terminalRequests.length
          ? { ...current, [selectedRoomId]: payload.terminalRequests }
          : current
      );
      setBrowserRequestsByRoom((current) =>
        payload.browserRequests.length
          ? { ...current, [selectedRoomId]: payload.browserRequests }
          : current
      );
      setInviteRequestsByRoom((current) =>
        payload.inviteRequests.length
          ? { ...current, [selectedRoomId]: payload.inviteRequests }
          : current
      );
      setCodexEventsByRoom((current) =>
        payload.codexEvents.length
          ? { ...current, [selectedRoomId]: payload.codexEvents }
          : current
      );
      setGitWorkflowEventsByRoom((current) =>
        payload.gitWorkflowEvents.length
          ? { ...current, [selectedRoomId]: payload.gitWorkflowEvents }
          : current
      );
      setGitHubActionsEventsByRoom((current) =>
        payload.githubActionsEvents.length
          ? { ...current, [selectedRoomId]: payload.githubActionsEvents }
          : current
      );
      setLocalPreviewsByRoom((current) =>
        payload.localPreviews.length
          ? { ...current, [selectedRoomId]: payload.localPreviews }
          : current
      );
      const latestGitWorkflowEvent = payload.gitWorkflowEvents.at(-1);
      if (latestGitWorkflowEvent) {
        setGitWorkflowMessageForRoom(selectedRoomId, latestGitWorkflowEvent.message);
      }
      const latestGitHubActionsEvent = payload.githubActionsEvents.at(-1);
      if (latestGitHubActionsEvent) {
        setActionRunsByRoom((current) => ({
          ...current,
          [selectedRoomId]: latestGitHubActionsEvent.runs
        }));
        setActionsLastCheckedByRoom((current) => ({
          ...current,
          [selectedRoomId]: latestGitHubActionsEvent.checkedAt
        }));
        setActionsMessagesByRoom((current) => ({
          ...current,
          [selectedRoomId]: `${latestGitHubActionsEvent.summary.label}: ${latestGitHubActionsEvent.message}`
        }));
      }
      if (payload.terminalSnapshots.length) {
        setTerminals((current) => replaceRoomTerminalSnapshots(current, selectedRoomId, payload.terminalSnapshots));
        setSelectedTerminalIdsByRoom((current) => {
          const currentTerminalId = current[selectedRoomId] ?? null;
          const nextTerminalId = currentTerminalId && payload.terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
            ? currentTerminalId
            : payload.terminalSnapshots[0]?.id ?? null;
          return nextTerminalId ? { ...current, [selectedRoomId]: nextTerminalId } : current;
        });
      }
      setHostHandoffsByRoom((current) =>
        payload.hostHandoffs.length
          ? { ...current, [selectedRoomId]: payload.hostHandoffs }
          : current
      );
      setCodexThreadIdsByRoom((current) => {
        const codexThreadId = normalizeCodexThreadId(payload.codexThreadId);
        return codexThreadId ? { ...current, [selectedRoomId]: codexThreadId } : current;
      });
    }).catch((error) => {
      if (!cancelled) console.warn("Failed to load encrypted local history", error);
    }).finally(() => {
      if (!cancelled) historyLoadedRoomIds.current.add(selectedRoomId);
    });
    return () => {
      cancelled = true;
    };
  }, [forgottenRoomIds, hasSelectedRoom, selectedRoomTeamId, selectedRoomId]);
}

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  RoomRecord
} from "@multaiplayer/protocol";
import {
  clearEncryptedHistory,
  forgetRoomLocalData,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../lib/localHistory";
import {
  loadTeamRoomDefaults,
  teamDefaultsRoomSettings
} from "../lib/teamRoomDefaults";
import { updateRoomSettings } from "../lib/workspaceClient";
import {
  type GitDiffResult,
  type GitStatusSummary,
  type ProjectFileContent,
  type ProjectFileEntry,
  type TerminalSnapshot
} from "../lib/localBackend";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { roomLockMessage } from "../lib/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { omitRecordKey } from "../lib/setUtils";
import {
  replaceRoomTerminalSnapshots,
  terminalsForLocalHistory
} from "../lib/terminalState";
import { pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { clearRoomVisibilityWarningAcknowledgement } from "../lib/roomVisibilityWarning";
import type { GitHubActionRun } from "../lib/authClient";
import type {
  BrowserAccessRequest,
  BrowserStatus,
  ChatAttachment,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  MarkdownCopyFallback,
  PendingCodexApproval,
  TerminalCommandRequest
} from "../types";

interface UseLocalHistoryActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
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
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  roomSettingsActor: () => {
    requesterName: string;
    requesterUserId: string;
  };
  setSelectedHistoryMessage: (message: string | null) => void;
  setHistoryMessageForRoom: (roomId: string, message: string | null) => void;
  setInviteApprovalGateForRoom: (roomId: string, enabled: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
  setHistorySettings: Dispatch<SetStateAction<LocalHistorySettings>>;
  setMessagesByRoom: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setTerminalRequestsByRoom: Dispatch<SetStateAction<Record<string, TerminalCommandRequest[]>>>;
  setBrowserRequestsByRoom: Dispatch<SetStateAction<Record<string, BrowserAccessRequest[]>>>;
  setInviteRequestsByRoom: Dispatch<SetStateAction<Record<string, InviteJoinRequest[]>>>;
  setCodexEventsByRoom: Dispatch<SetStateAction<Record<string, CodexRoomEvent[]>>>;
  setGitWorkflowEventsByRoom: Dispatch<SetStateAction<Record<string, GitWorkflowEventPlaintextPayload[]>>>;
  setGitHubActionsEventsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionsEventPlaintextPayload[]>>>;
  setLocalPreviewsByRoom: Dispatch<SetStateAction<Record<string, LocalPreviewRecord[]>>>;
  setTerminals: Dispatch<SetStateAction<TerminalSnapshot[]>>;
  setHostHandoffsByRoom: Dispatch<SetStateAction<Record<string, HostHandoffRecord[]>>>;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  setBrowserStatusByRoom: Dispatch<SetStateAction<Record<string, BrowserStatus>>>;
  setActiveBrowserUrlsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setCodexThreadIdsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setActionRunsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionRun[]>>>;
  setActionsLastCheckedByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setGitWorkflowBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHostBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHostMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setChatMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setMarkdownCopyFallbacksByRoom: Dispatch<SetStateAction<Record<string, MarkdownCopyFallback | null>>>;
  setSecretWarningsVisibleByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setSettingsBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSettingsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setCustomCodexModelsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectPathDraftsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setKeyRotationBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setApprovalVisibleByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPendingCodexApprovalsByRoom: Dispatch<SetStateAction<Record<string, PendingCodexApproval>>>;
  setCodexRunningByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setGitStatusByRoom: Dispatch<SetStateAction<Record<string, GitStatusSummary | null>>>;
  setFileQueriesByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectFilesByRoom: Dispatch<SetStateAction<Record<string, ProjectFileEntry[]>>>;
  setSelectedFilesByRoom: Dispatch<SetStateAction<Record<string, ProjectFileContent | null>>>;
  setSelectedDiffsByRoom: Dispatch<SetStateAction<Record<string, GitDiffResult | null>>>;
  setFileBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setFileMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setPendingAttachmentsByRoom: Dispatch<SetStateAction<Record<string, ChatAttachment[]>>>;
  setTerminalLinesByRoom: Dispatch<SetStateAction<Record<string, string[]>>>;
  setTerminalBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSelectedTerminalIdsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTerminalNamesByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalCommandsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalInputsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalErrorsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setBrowserUrlsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setBrowserReasonsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setBrowserMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setInviteLinksByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setInviteApprovalGatesByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setInviteMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setDraftsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setForgottenRoomIds: Dispatch<SetStateAction<Set<string>>>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
}

export function useLocalHistoryActions({
  hasSelectedRoom,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
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
  selectedCodexThreadId,
  reportRoomSettingsMutationInFlight,
  roomSettingsActor,
  setSelectedHistoryMessage,
  setHistoryMessageForRoom,
  setInviteApprovalGateForRoom,
  setSettingsBusyForRoom,
  setSecretWarningVisibleForRoom,
  setHistorySettings,
  setMessagesByRoom,
  setTerminalRequestsByRoom,
  setBrowserRequestsByRoom,
  setInviteRequestsByRoom,
  setCodexEventsByRoom,
  setGitWorkflowEventsByRoom,
  setGitHubActionsEventsByRoom,
  setLocalPreviewsByRoom,
  setTerminals,
  setHostHandoffsByRoom,
  setRooms,
  setBrowserStatusByRoom,
  setActiveBrowserUrlsByRoom,
  setCodexThreadIdsByRoom,
  setActionRunsByRoom,
  setActionsLastCheckedByRoom,
  setActionsMessagesByRoom,
  setActionsBusyByRoom,
  setGitWorkflowBusyByRoom,
  setHostBusyByRoom,
  setHostMessagesByRoom,
  setChatMessagesByRoom,
  setMarkdownCopyFallbacksByRoom,
  setSecretWarningsVisibleByRoom,
  setHistoryMessagesByRoom,
  setSettingsBusyByRoom,
  setSettingsMessagesByRoom,
  setCustomCodexModelsByRoom,
  setProjectPathDraftsByRoom,
  setKeyRotationBusyByRoom,
  setApprovalVisibleByRoom,
  setPendingCodexApprovalsByRoom,
  setCodexRunningByRoom,
  setGitStatusByRoom,
  setFileQueriesByRoom,
  setProjectFilesByRoom,
  setSelectedFilesByRoom,
  setSelectedDiffsByRoom,
  setFileBusyByRoom,
  setFileMessagesByRoom,
  setPendingAttachmentsByRoom,
  setTerminalLinesByRoom,
  setTerminalBusyByRoom,
  setSelectedTerminalIdsByRoom,
  setTerminalNamesByRoom,
  setTerminalCommandsByRoom,
  setTerminalInputsByRoom,
  setTerminalErrorsByRoom,
  setBrowserUrlsByRoom,
  setBrowserReasonsByRoom,
  setBrowserMessagesByRoom,
  setInviteLinksByRoom,
  setInviteApprovalGatesByRoom,
  setInviteMessagesByRoom,
  setDraftsByRoom,
  setForgottenRoomIds,
  historyLoadedRoomIds
}: UseLocalHistoryActionsOptions) {
  function updateLocalHistorySettings(next: LocalHistorySettings) {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const roomId = selectedRoom.id;
    const saved = saveHistorySettings(roomId, next);
    setHistorySettings(saved);
    if (saved.enabled) {
      const payload = pruneLocalRoomHistory({
        version: 3,
        messages,
        terminalRequests,
        browserRequests,
        inviteRequests,
        codexEvents,
        gitWorkflowEvents,
        githubActionsEvents,
        localPreviews,
        terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === roomId)),
        hostHandoffs,
        ...(selectedCodexThreadId ? { codexThreadId: selectedCodexThreadId } : {})
      }, saved.retentionDays);
      setMessagesByRoom((current) => ({ ...current, [roomId]: payload.messages }));
      setTerminalRequestsByRoom((current) => ({ ...current, [roomId]: payload.terminalRequests }));
      setBrowserRequestsByRoom((current) => ({ ...current, [roomId]: payload.browserRequests }));
      setInviteRequestsByRoom((current) => ({ ...current, [roomId]: payload.inviteRequests }));
      setCodexEventsByRoom((current) => ({ ...current, [roomId]: payload.codexEvents }));
      setGitWorkflowEventsByRoom((current) => ({ ...current, [roomId]: payload.gitWorkflowEvents }));
      setGitHubActionsEventsByRoom((current) => ({ ...current, [roomId]: payload.githubActionsEvents }));
      setLocalPreviewsByRoom((current) => ({ ...current, [roomId]: payload.localPreviews }));
      setTerminals((current) => replaceRoomTerminalSnapshots(current, roomId, payload.terminalSnapshots));
      setHostHandoffsByRoom((current) => ({ ...current, [roomId]: payload.hostHandoffs }));
    }
    setHistoryMessageForRoom(
      roomId,
      saved.enabled
        ? `Encrypted local history retention set to ${saved.retentionDays} days.`
        : "Encrypted local history is disabled for this room."
    );
  }

  async function applyTeamDefaultsToRoom() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before applying team defaults.");
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId, setHistoryMessageForRoom)) return;
    const teamId = selectedRoom.teamId;
    const historyDefaults = loadTeamHistorySettings(teamId);
    const roomDefaults = loadTeamRoomDefaults(teamId);
    updateLocalHistorySettings(historyDefaults);
    setInviteApprovalGateForRoom(roomId, roomDefaults.inviteApprovalGate);
    if (isSelectedRoomLocked) {
      setHistoryMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setHistoryMessageForRoom(
        roomId,
        "Applied local history and invite defaults. Claim host to apply approval and browser defaults to this room."
      );
      return;
    }
    setSettingsBusyForRoom(roomId, true);
    try {
      const roomSettings = teamDefaultsRoomSettings(roomDefaults);
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        ...roomSettings
      });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      if (!roomSettings.browserProfilePersistent) {
        setBrowserStatusByRoom((current) => omitRecordKey(current, roomId));
        setActiveBrowserUrlsByRoom((current) => omitRecordKey(current, roomId));
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHistoryMessageForRoom(roomId, "Applied team defaults to this room.");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHistoryMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  function clearRoomScopedState(roomId: string) {
    setMessagesByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setTerminalRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setBrowserRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setInviteRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitWorkflowEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitHubActionsEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setHostHandoffsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexThreadIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionRunsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitWorkflowBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setChatMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setMarkdownCopyFallbacksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSecretWarningsVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistoryMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCustomCodexModelsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectPathDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setKeyRotationBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setApprovalVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingCodexApprovalsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCodexRunningByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActiveBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileQueriesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedDiffsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingAttachmentsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalLinesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedTerminalIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalNamesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalCommandsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalInputsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalErrorsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminals((current) => current.filter((terminal) => terminal.roomId !== selectedRoom.id));
    setBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserReasonsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteLinksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteApprovalGatesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
  }

  async function clearRoomHistory() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before clearing local history.");
      return;
    }
    const roomId = selectedRoom.id;
    await clearEncryptedHistory(selectedRoom.id);
    clearRoomScopedState(roomId);
    setHistoryMessageForRoom(roomId, "Cleared encrypted local history for this room.");
  }

  async function forgetSelectedRoomLocalData() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before forgetting local room data.");
      return;
    }
    const roomId = selectedRoom.id;
    const confirmed = window.confirm(
      `Forget ${selectedRoom.name} on this device?\n\nThis deletes local history, room settings, and this device's room access. You will need a fresh invite or host approval to read or send room messages again.`
    );
    if (!confirmed) return;
    await forgetRoomLocalData(selectedRoom.id);
    clearRoomVisibilityWarningAcknowledgement(selectedRoom.id);
    historyLoadedRoomIds.current.delete(selectedRoom.id);
    setForgottenRoomIds((current) => new Set(current).add(selectedRoom.id));
    clearRoomScopedState(roomId);
    setHistorySettings(loadHistorySettings(selectedRoom.id));
    setSecretWarningVisibleForRoom(selectedRoom.id, true);
    setHistoryMessageForRoom(roomId, "Forgot this room on this device. Rejoin from an invite to unlock it again.");
  }

  return {
    updateLocalHistorySettings,
    applyTeamDefaultsToRoom,
    clearRoomHistory,
    forgetSelectedRoomLocalData
  };
}

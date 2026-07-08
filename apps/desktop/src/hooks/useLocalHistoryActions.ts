import type { MutableRefObject } from "react";
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
  type TerminalSnapshot
} from "../lib/localBackend";
import { roomLockMessage } from "../lib/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import {
  terminalsForLocalHistory
} from "../lib/terminalState";
import { pruneLocalRoomHistory } from "../lib/localRoomHistoryPayload";
import { clearRoomVisibilityWarningAcknowledgement } from "../lib/roomVisibilityWarning";
import { useAppStore } from "../store/appStore";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
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
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: ReturnType<typeof pruneLocalRoomHistory>) => void;
  replaceRoom: (room: RoomRecord) => void;
  clearBrowserStatusForRoom: (roomId: string) => void;
  rememberForgottenRoom: (roomId: string) => void;
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
  replaceHistorySettings,
  hydrateLocalRoomHistoryForRoom,
  replaceRoom,
  clearBrowserStatusForRoom,
  rememberForgottenRoom,
  historyLoadedRoomIds
}: UseLocalHistoryActionsOptions) {
  const clearRoomScopedStateForRoom = useAppStore((state) => state.clearRoomScopedStateForRoom);

  function updateLocalHistorySettings(next: LocalHistorySettings) {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const roomId = selectedRoom.id;
    const saved = saveHistorySettings(roomId, next);
    replaceHistorySettings(saved);
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
      hydrateLocalRoomHistoryForRoom(roomId, payload);
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
      replaceRoom(room);
      if (!roomSettings.browserProfilePersistent) {
        clearBrowserStatusForRoom(roomId);
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

  async function clearRoomHistory() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before clearing local history.");
      return;
    }
    const roomId = selectedRoom.id;
    await clearEncryptedHistory(selectedRoom.id);
    clearRoomScopedStateForRoom(roomId);
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
    rememberForgottenRoom(selectedRoom.id);
    clearRoomScopedStateForRoom(roomId);
    replaceHistorySettings(loadHistorySettings(selectedRoom.id));
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

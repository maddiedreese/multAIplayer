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
} from "./localHistory";
import {
  loadTeamRoomDefaults,
  teamDefaultsRoomSettings
} from "./teamRoomDefaults";
import { updateRoomSettings } from "./workspaceClient";
import {
  type TerminalSnapshot
} from "./localBackend";
import { roomLockMessage } from "./appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import {
  terminalsForLocalHistory
} from "./terminalState";
import { pruneLocalRoomHistory } from "./localRoomHistoryPayload";
import { clearRoomVisibilityWarningAcknowledgement } from "./roomVisibilityWarning";
import { useAppStore } from "../store/appStore";
import { omitRecordKey } from "./setUtils";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  CodexActivity,
  CodexThreadGraph,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  RoomGoal,
  TerminalCommandRequest,
  WorkspaceFileSaveRequest
} from "../types";

type BusyMap = Record<string, boolean>;

interface CreateLocalHistoryActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  messages: ChatMessage[];
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
  roomGoal: RoomGoal | null;
  selectedCodexThreadId: string | null;
  codexThreadGraph: CodexThreadGraph;
  settingsBusyRef: MutableRefObject<BusyMap>;
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  roomSettingsActor: () => {
    requesterName: string;
    requesterUserId: string;
  };
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  replaceRoom: (room: RoomRecord) => void;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
}

export function createLocalHistoryActions({
  hasSelectedRoom,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  messages,
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
  roomGoal,
  selectedCodexThreadId,
  codexThreadGraph,
  settingsBusyRef,
  reportRoomSettingsMutationInFlight,
  roomSettingsActor,
  replaceHistorySettings,
  replaceRoom,
  historyLoadedRoomIds
}: CreateLocalHistoryActionsOptions) {
  const setSelectedHistoryMessage = (message: string | null) =>
    useAppStore.getState().setHistoryMessageForRoom(selectedRoomIdRef.current, message);
  const setHistoryMessageForRoom = (roomId: string, message: string | null) =>
    useAppStore.getState().setHistoryMessageForRoom(roomId, message);
  const setSettingsBusyForRoom = (roomId: string, busy: boolean) => {
    settingsBusyRef.current = busy
      ? { ...settingsBusyRef.current, [roomId]: true }
      : omitRecordKey(settingsBusyRef.current, roomId);
    useAppStore.getState().setSettingsBusyForRoom(roomId, busy);
  };

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
        fileSaveRequests,
        browserRequests,
        inviteRequests,
        codexEvents,
        codexActivities,
        gitWorkflowEvents,
        githubActionsEvents,
        localPreviews,
        terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === roomId)),
        hostHandoffs,
        ...(roomGoal ? { roomGoal } : {}),
        ...(selectedCodexThreadId ? { codexThreadId: selectedCodexThreadId } : {}),
        ...(codexThreadGraph.activeThreadId ? { codexThreadGraph } : {})
      }, saved.retentionDays);
      useAppStore.getState().hydrateLocalRoomHistoryForRoom(roomId, payload);
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
    useAppStore.getState().setInviteApprovalGateForRoom(roomId, roomDefaults.inviteApprovalGate);
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
        useAppStore.getState().clearBrowserStatusForRoom(roomId);
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
    useAppStore.getState().clearRoomScopedStateForRoom(roomId);
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
    useAppStore.getState().rememberForgottenRoom(selectedRoom.id);
    useAppStore.getState().clearRoomScopedStateForRoom(roomId);
    replaceHistorySettings(loadHistorySettings(selectedRoom.id));
    useAppStore.getState().setSecretWarningVisibleForRoom(selectedRoom.id, true);
    setHistoryMessageForRoom(roomId, "Forgot this room on this device. Rejoin from an invite to unlock it again.");
  }

  return {
    updateLocalHistorySettings,
    applyTeamDefaultsToRoom,
    clearRoomHistory,
    forgetSelectedRoomLocalData
  };
}

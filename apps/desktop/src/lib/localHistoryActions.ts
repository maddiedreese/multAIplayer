import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  clearEncryptedHistory,
  forgetRoomLocalData,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "./localHistory";
import { loadTeamRoomDefaults, teamDefaultsRoomSettings } from "./teamRoomDefaults";
import { updateRoomSettings } from "./workspaceClient";
import { roomLockMessage } from "./appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import { terminalsForLocalHistory } from "./terminalState";
import { pruneLocalRoomHistory } from "./localRoomHistoryPayload";
import { clearRoomVisibilityWarningAcknowledgement } from "./roomVisibilityWarning";
import { useAppStore } from "../store/appStore";
import { omitRecordKey } from "./setUtils";
import { currentSelectedRoomContext } from "./selectedWorkspace";

type BusyMap = Record<string, boolean>;

interface CreateLocalHistoryActionsOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  settingsBusyRef: MutableRefObject<BusyMap>;
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  replaceRoom: (room: RoomRecord) => void;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
}

export function createLocalHistoryActions({
  selectedRoomIdRef,
  settingsBusyRef,
  reportRoomSettingsMutationInFlight,
  replaceHistorySettings,
  replaceRoom,
  historyLoadedRoomIds
}: CreateLocalHistoryActionsOptions) {
  const currentSelectedRoom = () => {
    const state = useAppStore.getState();
    return state.rooms.find((room) => room.id === state.selectedRoomId);
  };
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const roomId = selectedRoom.id;
    const saved = saveHistorySettings(roomId, next);
    replaceHistorySettings(saved);
    if (saved.enabled) {
      const store = useAppStore.getState();
      const codexRuntime = store.codexRuntimeByRoom[roomId] ?? {};
      const gitRuntime = store.gitWorkflowRuntimeByRoom[roomId] ?? {};
      const codexThreadGraph = codexRuntime.threadGraph ?? { activeThreadId: null, nodesById: {} };
      const payload = pruneLocalRoomHistory(
        {
          version: 3,
          messages: store.messagesByRoom[roomId] ?? [],
          terminalRequests: store.terminalRuntimeByRoom[roomId]?.requests ?? [],
          fileSaveRequests: store.filePanelByRoom[roomId]?.saveRequests ?? [],
          browserRequests: store.browserByRoom[roomId]?.requests ?? [],
          inviteRequests: store.inviteByRoom[roomId]?.requests ?? [],
          codexEvents: codexRuntime.events ?? [],
          codexActivities: codexRuntime.activities ?? [],
          gitWorkflowEvents: gitRuntime.workflow?.events ?? [],
          githubActionsEvents: gitRuntime.actions?.events ?? [],
          localPreviews: store.localPreviewByRoom[roomId]?.previews ?? [],
          terminalSnapshots: terminalsForLocalHistory(store.terminals.filter((terminal) => terminal.roomId === roomId)),
          hostHandoffs: codexRuntime.hostHandoffs ?? [],
          ...(codexRuntime.goal ? { roomGoal: codexRuntime.goal } : {}),
          ...(codexThreadGraph.activeThreadId ? { codexThreadId: codexThreadGraph.activeThreadId } : {}),
          ...(codexThreadGraph.activeThreadId ? { codexThreadGraph } : {})
        },
        saved.retentionDays
      );
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
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
    const { forgottenRoomIds, revokedRoomIds, revokedTeamIds } = useAppStore.getState();
    const isSelectedRoomRevoked = revokedRoomIds.has(roomId) || revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || forgottenRoomIds.has(roomId) || isSelectedRoomRevoked;
    if (isSelectedRoomLocked) {
      setHistoryMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const context = currentSelectedRoomContext();
    if (!context?.isActiveHost) {
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
        requesterName: context.localUser.name,
        requesterUserId: context.localUser.id,
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setHistoryMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function clearRoomHistory() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedHistoryMessage("Create or join a room before clearing local history.");
      return;
    }
    const roomId = selectedRoom.id;
    await clearEncryptedHistory(selectedRoom.id);
    useAppStore.getState().clearRoomScopedStateForRoom(roomId);
    setHistoryMessageForRoom(roomId, "Cleared encrypted local history for this room.");
  }

  async function forgetSelectedRoomLocalData() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
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

import type { MutableRefObject } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  clearEncryptedHistory,
  forgetRoomLocalData,
  loadHistorySettings,
  loadTeamHistorySettings,
  saveHistorySettings,
  type LocalHistorySettings
} from "../../lib/history/localHistory";
import { loadTeamRoomDefaults, teamDefaultsRoomSettings } from "../../lib/team/teamRoomDefaults";
import { updateRoomSettings } from "../workspace/workspaceClient";
import { roomLockMessage } from "../runtime/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { terminalsForLocalHistory } from "../../lib/terminal/terminalState";
import { pruneLocalRoomHistory } from "../../lib/history/localRoomHistoryPayload";
import { clearRoomVisibilityWarningAcknowledgement } from "../../lib/history/roomVisibilityWarning";
import { useAppStore } from "../../store/appStore";
import { omitRecordKey } from "../../lib/core/setUtils";
import { currentSelectedRoomContext } from "../workspace/selectedWorkspace";

type BusyMap = Record<string, boolean>;

interface CreateLocalHistoryActionsOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  settingsBusyRef: MutableRefObject<BusyMap>;
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  replaceHistorySettings: (next: LocalHistorySettings) => void;
  replaceRoom: (room: ClientRoomRecord) => void;
}

export function createLocalHistoryActions({
  selectedRoomIdRef,
  settingsBusyRef,
  reportRoomSettingsMutationInFlight,
  replaceHistorySettings,
  replaceRoom
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

  async function updateLocalHistorySettings(next: LocalHistorySettings) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const roomId = selectedRoom.id;
    let saved: LocalHistorySettings;
    try {
      saved = await saveHistorySettings(roomId, next);
    } catch (error) {
      setHistoryMessageForRoom(roomId, `Encrypted local history settings were not changed: ${String(error)}`);
      return;
    }
    replaceHistorySettings(saved);
    if (saved.enabled) {
      const payload = localHistoryPayloadForRoom(roomId, saved.retentionDays);
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
    await updateLocalHistorySettings(historyDefaults);
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
    useAppStore.getState().setHistoryHydrationStatusForRoom(selectedRoom.id, undefined);
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

function localHistoryPayloadForRoom(roomId: string, retentionDays: number) {
  const store = useAppStore.getState();
  const codexRuntime = store.codexRuntimeByRoom[roomId] ?? {};
  const gitRuntime = store.gitWorkflowRuntimeByRoom[roomId] ?? {};
  return pruneLocalRoomHistory(
    {
      version: 3,
      messages: store.messagesByRoom[roomId] ?? [],
      terminalRequests: store.terminalRuntimeByRoom[roomId]?.requests ?? [],
      fileSaveRequests: store.filePanelByRoom[roomId]?.saveRequests ?? [],
      browserRequests: store.browserByRoom[roomId]?.requests ?? [],
      inviteRequests: store.inviteByRoom[roomId]?.requests ?? [],
      ...codexHistoryFields(codexRuntime),
      ...gitHistoryFields(gitRuntime),
      localPreviews: store.localPreviewByRoom[roomId]?.previews ?? [],
      terminalSnapshots: terminalsForLocalHistory(store.terminals.filter((terminal) => terminal.roomId === roomId))
    },
    retentionDays
  );
}

function codexHistoryFields(codexRuntime: ReturnType<typeof useAppStore.getState>["codexRuntimeByRoom"][string]) {
  const codexThreadGraph = codexRuntime.threadGraph ?? { activeThreadId: null, nodesById: {} };
  return {
    codexEvents: codexRuntime.events ?? [],
    codexActivities: codexRuntime.activities ?? [],
    hostHandoffs: codexRuntime.hostHandoffs ?? [],
    ...(codexRuntime.goal ? { roomGoal: codexRuntime.goal } : {}),
    ...(codexThreadGraph.activeThreadId ? { codexThreadGraph } : {})
  };
}

function gitHistoryFields(gitRuntime: ReturnType<typeof useAppStore.getState>["gitWorkflowRuntimeByRoom"][string]) {
  return {
    gitWorkflowEvents: gitRuntime.workflow?.events ?? [],
    githubActionsEvents: gitRuntime.actions?.events ?? []
  };
}

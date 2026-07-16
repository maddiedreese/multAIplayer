import type { ClientRoomRecord, RoomSettingsPlaintextPayload } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { roomLockMessage } from "../runtime/appRuntime";
import { chooseProjectFolder, shutdownCodexRoom } from "../../lib/platform/localBackend";
import type { RoomSettingsMutationContext } from "./roomSettingsMutationContext";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { currentSelectedRoom } from "../workspace/selectedWorkspace";
import { updateRoomSettings } from "../workspace/workspaceClient";
import { maxRoomProjectPathChars, normalizeProjectPath } from "../../lib/workspace/workspaceCreation";

interface ProjectActionsOptions {
  selectedRoomId: () => string | null;
  reportInFlight: (roomId: string) => boolean;
  replaceRoom: (room: ClientRoomRecord) => void;
  publishEvent: (
    room: ClientRoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) => Promise<void>;
  context: RoomSettingsMutationContext;
}

export function createRoomProjectSettingsActions(options: ProjectActionsOptions) {
  const c = options.context;
  async function updateProjectPath() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const draft =
      useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.projectPathDraft ?? selectedRoom.projectPath;
    const nextProjectPath = normalizeProjectPath(draft);
    if (!nextProjectPath) {
      c.setSelectedSettingsMessage(
        `Enter a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`
      );
      return;
    }
    if (nextProjectPath === selectedRoom.projectPath) return;
    if (c.currentRoomAccess(selectedRoom).locked) {
      c.setSelectedSettingsMessage(roomLockMessage(selectedRoom, c.currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!c.isCurrentUserActiveHost()) {
      c.setSelectedSettingsMessage(c.currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    if (options.reportInFlight(roomId)) return;
    c.setSettingsBusyForRoom(roomId, true);
    c.setSettingsMessageForRoom(roomId, null);
    try {
      const room = await updateRoomSettings(roomId, { ...c.currentRoomSettingsActor(), projectPath: nextProjectPath });
      void shutdownCodexRoom(roomId);
      options.replaceRoom(room);
      await options.publishEvent(room, {
        id: crypto.randomUUID(),
        setting: "projectPath",
        previousValue: selectedRoom.projectPath,
        nextValue: nextProjectPath,
        changedAt: new Date().toISOString()
      });
      c.resetFileContextForRoom(roomId);
      c.resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId))
        c.setSettingsMessageForRoom(roomId, `Project folder set to ${nextProjectPath}.`);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId))
        c.setSettingsMessageForRoom(roomId, String(error));
    } finally {
      c.setSettingsBusyForRoom(roomId, false);
    }
  }

  async function chooseProjectPath() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const draft =
      useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.projectPathDraft ?? selectedRoom.projectPath;
    if (c.currentRoomAccess(selectedRoom).locked) {
      c.setSelectedSettingsMessage(roomLockMessage(selectedRoom, c.currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!c.isCurrentUserActiveHost()) {
      c.setSelectedSettingsMessage(c.currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    c.setSettingsMessageForRoom(roomId, null);
    try {
      const selectedPath = await chooseProjectFolder(draft || selectedRoom.projectPath);
      if (!selectedPath) {
        if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId))
          c.setSettingsMessageForRoom(roomId, "No project folder was selected.");
        return;
      }
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId)) {
        c.setProjectPathDraftForRoom(roomId, selectedPath);
        c.setSettingsMessageForRoom(roomId, `Selected project folder: ${selectedPath}`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId))
        c.setSettingsMessageForRoom(roomId, String(error));
    }
  }
  return { updateProjectPath, chooseProjectPath };
}

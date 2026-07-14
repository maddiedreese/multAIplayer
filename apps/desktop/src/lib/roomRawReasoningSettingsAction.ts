import type { RoomRecord, RoomSettingsPlaintextPayload } from "@multaiplayer/protocol";
import { currentSelectedRoom } from "./selectedWorkspace";
import { roomLockMessage } from "./appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import { updateRoomSettings } from "./workspaceClient";
import type { RoomSettingsMutationContext } from "./roomSettingsMutationContext";

export async function updateCodexRawReasoningSetting(
  enabled: boolean,
  options: {
    selectedRoomId: () => string;
    reportInFlight: (roomId: string) => boolean;
    replaceRoom: (room: RoomRecord) => void;
    publishEvent: (
      room: RoomRecord,
      event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
    ) => Promise<void>;
    context: RoomSettingsMutationContext;
  }
) {
  const room = currentSelectedRoom();
  if (!room || enabled === (room.codexRawReasoningEnabled ?? false)) return;
  const access = options.context.currentRoomAccess(room);
  if (access.locked) {
    options.context.setSelectedSettingsMessage(roomLockMessage(room, access.revoked));
    return;
  }
  if (!options.context.isCurrentUserActiveHost()) {
    options.context.setSelectedSettingsMessage(options.context.currentRoomSettingsGateMessage());
    return;
  }
  if (options.reportInFlight(room.id)) return;
  options.context.setSettingsBusyForRoom(room.id, true);
  options.context.setSettingsMessageForRoom(room.id, null);
  try {
    const previousValue = room.codexRawReasoningEnabled ?? false;
    const updatedRoom = await updateRoomSettings(room.id, {
      ...options.context.currentRoomSettingsActor(),
      codexRawReasoningEnabled: enabled
    });
    options.replaceRoom(updatedRoom);
    await options.publishEvent(updatedRoom, {
      id: crypto.randomUUID(),
      setting: "codexRawReasoningEnabled",
      previousValue: String(previousValue),
      nextValue: String(enabled),
      changedAt: new Date().toISOString()
    });
    if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), room.id)) {
      options.context.setSettingsMessageForRoom(
        room.id,
        enabled
          ? "Raw provider reasoning will be shared with and retained by room members."
          : "Raw provider reasoning sharing is off; Codex reasoning summaries remain visible."
      );
    }
  } catch (error) {
    if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), room.id)) {
      options.context.setSettingsMessageForRoom(room.id, String(error));
    }
  } finally {
    options.context.setSettingsBusyForRoom(room.id, false);
  }
}

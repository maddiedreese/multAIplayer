import type {
  ApprovalDelegationPolicy,
  ApprovalPolicy,
  ClientRoomRecord,
  RoomSettingsPlaintextPayload
} from "@multaiplayer/protocol";
import { roomLockMessage } from "../runtime/appRuntime";
import type { RoomSettingsMutationContext } from "./roomSettingsMutationContext";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { currentSelectedRoom } from "../workspace/selectedWorkspace";
import { updateRoomSettings } from "../workspace/workspaceClient";

interface ApprovalActionsOptions {
  selectedRoomId: () => string;
  approvalPolicyLabels: Record<string, string>;
  reportInFlight: (roomId: string) => boolean;
  replaceRoom: (room: ClientRoomRecord) => void;
  publishEvent: (
    room: ClientRoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) => Promise<void>;
  context: RoomSettingsMutationContext;
}

export function createRoomApprovalSettingsActions(options: ApprovalActionsOptions) {
  const c = options.context;

  async function mutateApproval(
    setting: "approvalPolicy" | "approvalDelegationPolicy",
    nextValue: ApprovalPolicy | ApprovalDelegationPolicy,
    successMessage: string
  ): Promise<void> {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      c.setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    const access = c.currentRoomAccess(selectedRoom);
    if (access.locked) {
      c.setSelectedSettingsMessage(roomLockMessage(selectedRoom, access.revoked));
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
      const previousValue = selectedRoom[setting];
      const room = await updateRoomSettings(roomId, { ...c.currentRoomSettingsActor(), [setting]: nextValue });
      options.replaceRoom(room);
      await options.publishEvent(room, {
        id: crypto.randomUUID(),
        setting,
        previousValue,
        nextValue,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId)) {
        c.setSettingsMessageForRoom(roomId, successMessage);
      }
      c.resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(options.selectedRoomId(), roomId)) {
        c.setSettingsMessageForRoom(roomId, String(error));
      }
    } finally {
      c.setSettingsBusyForRoom(roomId, false);
    }
  }

  return {
    setApprovalPolicy: (policy: ApprovalPolicy) =>
      mutateApproval("approvalPolicy", policy, `Approval policy set to ${options.approvalPolicyLabels[policy]}.`),
    setApprovalDelegationPolicy: (policy: ApprovalDelegationPolicy) =>
      mutateApproval("approvalDelegationPolicy", policy, "Approval delegation updated.")
  };
}

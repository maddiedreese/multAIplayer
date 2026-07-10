import type { RelayEnvelope, RoomKeyRotationPlaintextPayload } from "@multaiplayer/protocol";
import { createRoomSecret, encryptJson } from "@multaiplayer/crypto";
import { loadOrCreateRoomSecret, replaceRoomSecret } from "../localHistory";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { formatMessageTime } from "../appFormatters";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { UseInviteActionsOptions } from "./inviteActionTypes";

type RoomKeyRotationActionOptions = Pick<
  UseInviteActionsOptions,
  | "deviceId"
  | "hasSelectedRoom"
  | "historyLoadedRoomIds"
  | "hostGateMessage"
  | "isActiveHost"
  | "isSelectedRoomLocked"
  | "isSelectedRoomRevoked"
  | "localUser"
  | "relayRef"
  | "relayStatus"
  | "reportRoomKeyRotationInFlight"
  | "seenEnvelopeIds"
  | "selectedRoom"
  | "selectedRoomIdRef"
>;

type RoomKeyRotationStore = Pick<
  AppStoreState,
  | "appendRoomMessage"
  | "restoreForgottenRoom"
  | "setInviteLinkForRoom"
  | "setInviteMessageForRoom"
  | "setKeyRotationBusyForRoom"
>;

export function createRoomKeyRotationActions(
  options: RoomKeyRotationActionOptions,
  store: RoomKeyRotationStore = useAppStore.getState()
) {
  const {
    deviceId,
    hasSelectedRoom,
    historyLoadedRoomIds,
    hostGateMessage,
    isActiveHost,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    localUser,
    relayRef,
    relayStatus,
    reportRoomKeyRotationInFlight,
    seenEnvelopeIds,
    selectedRoom,
    selectedRoomIdRef
  } = options;
  const {
    appendRoomMessage,
    restoreForgottenRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setKeyRotationBusyForRoom
  } = store;
  const setSelectedInviteMessage = (message: string | null) =>
    setInviteMessageForRoom(selectedRoomIdRef.current, message);

  async function rotateSelectedRoomKey() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before refreshing room access.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedInviteMessage(hostGateMessage);
      return;
    }
    if (reportRoomKeyRotationInFlight(selectedRoom.id)) return;
    const confirmed = window.confirm(
      `Refresh room access for ${selectedRoom.name}?\n\n` +
      "This updates future messages and invites for current members. " +
      "It is not full member removal in the alpha."
    );
    if (!confirmed) return;

    setKeyRotationBusyForRoom(selectedRoom.id, true);
    setInviteMessageForRoom(selectedRoom.id, null);
    try {
      const oldSecret = await loadOrCreateRoomSecret(selectedRoom.id);
      const newSecret = await createRoomSecret();
      const rotatedAt = new Date().toISOString();
      const payload: RoomKeyRotationPlaintextPayload = {
        eventType: "room.key.rotated",
        id: crypto.randomUUID(),
        rotatedBy: localUser.name,
        rotatedByUserId: localUser.id,
        rotatedAt,
        newSecret,
        note: "Future room messages and invites use this key."
      };

      const client = relayRef.current;
      if (client && relayStatus !== "closed" && relayStatus !== "error") {
        const envelope: RelayEnvelope = {
          id: crypto.randomUUID(),
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          senderDeviceId: deviceId,
          senderUserId: localUser.id,
          createdAt: rotatedAt,
          kind: "room.key",
          payload: await encryptJson(payload, oldSecret)
        };
        seenEnvelopeIds.current.add(envelope.id);
        client.publish({ type: "publish", envelope });
      }

      await replaceRoomSecret(selectedRoom.id, newSecret);
      historyLoadedRoomIds.current.add(selectedRoom.id);
      appendRoomMessage(selectedRoom.id, {
        id: payload.id,
        author: "multAIplayer",
        role: "system",
        body: `${localUser.name} refreshed room access. Future messages and invites use the updated access state.`,
        time: formatMessageTime(rotatedAt),
        createdAt: rotatedAt
      });
      restoreForgottenRoom(selectedRoom.id);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, selectedRoom.id)) {
        setInviteLinkForRoom(selectedRoom.id, "");
        setInviteMessageForRoom(
          selectedRoom.id,
          client && relayStatus !== "closed" && relayStatus !== "error"
            ? "Refreshed room access for future messages and invites."
            : "Refreshed access locally, but the relay is offline. Other members will need a fresh invite."
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, selectedRoom.id)) {
        setInviteMessageForRoom(selectedRoom.id, String(error));
      }
    } finally {
      setKeyRotationBusyForRoom(selectedRoom.id, false);
    }
  }

  return { rotateSelectedRoomKey };
}

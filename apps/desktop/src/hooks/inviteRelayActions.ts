import type {
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  RelayEnvelope
} from "@multaiplayer/protocol";
import {
  decryptJson,
  encryptJson,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  wrapRoomSecretForDevice
} from "@multaiplayer/crypto";
import {
  importRoomSecret,
  loadOrCreateRoomSecret,
  loadRoomSecret
} from "../lib/localHistory";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "../lib/inviteApproval";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import {
  isDeviceSealedPayload,
  isInviteJoinRequestPlaintextPayload,
  isInviteJoinStatusPlaintextPayload
} from "../lib/localRoomHistoryPayload";
import { roomLockMessage } from "../lib/appRuntime";
import type { InviteJoinRequest } from "../types";
import type { UseInviteActionsOptions } from "./inviteActionTypes";

type InviteRelayActionOptions = Pick<
  UseInviteActionsOptions,
  | "appendInviteRequest"
  | "deviceId"
  | "deviceIdentity"
  | "hasSelectedRoom"
  | "hostGateMessage"
  | "inviteRequests"
  | "isActiveHost"
  | "isSelectedRoomLocked"
  | "isSelectedRoomRevoked"
  | "localUser"
  | "relayRef"
  | "relayStatus"
  | "rememberForgottenRoom"
  | "restoreForgottenRoom"
  | "seenEnvelopeIds"
  | "selectedRoom"
  | "selectedRoomIdRef"
  | "setInviteMessageForRoom"
  | "setSelectedInviteMessage"
  | "updateInviteRequestStatus"
>;

export function createInviteRelayActions(options: InviteRelayActionOptions) {
  const {
    appendInviteRequest,
    deviceId,
    deviceIdentity,
    hasSelectedRoom,
    hostGateMessage,
    inviteRequests,
    isActiveHost,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    localUser,
    relayRef,
    relayStatus,
    rememberForgottenRoom,
    restoreForgottenRoom,
    seenEnvelopeIds,
    selectedRoom,
    selectedRoomIdRef,
    setInviteMessageForRoom,
    setSelectedInviteMessage,
    updateInviteRequestStatus
  } = options;

  async function publishInviteJoinRequest(
    teamId: string,
    roomId: string,
    request: InviteJoinRequestPlaintextPayload,
    recipientPublicKeyJwk?: Record<string, unknown>
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return false;
    const payload = recipientPublicKeyJwk
      ? await sealJsonToDevice(request, recipientPublicKeyJwk)
      : await encryptJson(request, await loadOrCreateRoomSecret(roomId));
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: request.requestedAt,
      kind: "room.invite",
      payload
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    return true;
  }

  async function decryptInviteEnvelope(envelope: RelayEnvelope): Promise<unknown | null> {
    if (deviceIdentity && isDeviceSealedPayload(envelope.payload)) {
      try {
        return await openDeviceSealedJson<unknown>(envelope.payload, deviceIdentity.privateKeyJwk);
      } catch {
        return null;
      }
    }
    if (envelope.payload.algorithm === "AES-GCM-256") {
      const secret = await loadRoomSecret(envelope.roomId);
      if (!secret) {
        rememberForgottenRoom(envelope.roomId);
        return null;
      }
      return decryptJson<unknown>(envelope.payload, secret);
    }
    return null;
  }

  async function handleInviteEnvelopePlaintext(roomId: string, plaintext: unknown) {
    if (isInviteJoinRequestPlaintextPayload(plaintext)) {
      appendInviteRequest(roomId, { ...plaintext, status: "pending" });
      return;
    }
    if (!isInviteJoinStatusPlaintextPayload(plaintext)) return;
    updateInviteRequestStatus(roomId, plaintext.requestId, plaintext.status);
    if (!plaintext.requestId.startsWith(`${deviceId}:`)) return;
    if (
      plaintext.status === "approved" &&
      plaintext.wrappedRoomSecret &&
      plaintext.recipientDeviceId === deviceId &&
      deviceIdentity
    ) {
      const secret = await unwrapRoomSecretForDevice(
        plaintext.wrappedRoomSecret,
        deviceIdentity.privateKeyJwk
      );
      await importRoomSecret(roomId, secret);
      restoreForgottenRoom(roomId);
    }
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setInviteMessageForRoom(
        roomId,
        plaintext.status === "approved"
          ? plaintext.wrappedRoomSecret
            ? `${plaintext.decidedBy} approved your room join request. This room is unlocked on this device.`
            : `${plaintext.decidedBy} approved your room join request.`
          : `${plaintext.decidedBy} denied your room join request.`
      );
    }
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before deciding invite requests.");
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
    if (status === "pending") return;
    const roomRequest = findRoomInviteRequest(inviteRequests, request.id);
    if (!roomRequest || !canActOnRoomInviteRequest(inviteRequests, request.id)) {
      setInviteMessageForRoom(selectedRoom.id, roomInviteRequestMessage(inviteRequests, request.id));
      return;
    }
    updateInviteRequestStatus(selectedRoom.id, roomRequest.id, status);
    setInviteMessageForRoom(
      selectedRoom.id,
      `${status === "approved" ? "Approved" : "Denied"} ${roomRequest.requester}'s join request.`
    );
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    try {
      const secret = await loadOrCreateRoomSecret(selectedRoom.id);
      const wrappedRoomSecret = status === "approved" && roomRequest.requesterPublicKeyJwk
        ? await wrapRoomSecretForDevice(secret, roomRequest.requesterPublicKeyJwk)
        : undefined;
      const payload: InviteJoinStatusPlaintextPayload = {
        eventType: "invite.status",
        requestId: roomRequest.id,
        status,
        decidedBy: localUser.name,
        decidedByUserId: localUser.id,
        decidedAt: new Date().toISOString(),
        recipientDeviceId: roomRequest.requesterDeviceId,
        recipientPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        wrappedRoomSecret
      };
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: payload.decidedAt,
        kind: "room.invite",
        payload: roomRequest.requesterPublicKeyJwk
          ? await sealJsonToDevice(payload, roomRequest.requesterPublicKeyJwk)
          : await encryptJson(payload, secret)
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, selectedRoom.id)) {
        setInviteMessageForRoom(selectedRoom.id, String(error));
      }
    }
  }

  return {
    decideInviteJoinRequest,
    decryptInviteEnvelope,
    handleInviteEnvelopePlaintext,
    publishInviteJoinRequest
  };
}

import {
  DeviceSealedPayload,
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  type RelayEnvelope
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
} from "../localHistory";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "../inviteApproval";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { InviteJoinRequest } from "../../types";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoomContext } from "../selectedWorkspace";

type InviteRelayActionOptions = Pick<
  UseInviteActionsOptions,
  | "relayRef"
  | "seenEnvelopeIds"
  | "selectedRoomIdRef"
>;

type InviteRelayStore = Pick<
  AppStoreState,
  | "appendInviteRequest"
  | "rememberForgottenRoom"
  | "restoreForgottenRoom"
  | "setInviteMessageForRoom"
  | "updateInviteRequestStatus"
>;

export function createInviteRelayActions(
  options: InviteRelayActionOptions,
  store: InviteRelayStore = useAppStore.getState()
) {
  const {
    relayRef,
    seenEnvelopeIds,
    selectedRoomIdRef
  } = options;
  const {
    appendInviteRequest,
    rememberForgottenRoom,
    restoreForgottenRoom,
    setInviteMessageForRoom,
    updateInviteRequestStatus
  } = store;
  const setSelectedInviteMessage = (message: string | null) =>
    setInviteMessageForRoom(selectedRoomIdRef.current, message);

  async function publishInviteJoinRequest(
    teamId: string,
    roomId: string,
    request: InviteJoinRequestPlaintextPayload,
    recipientPublicKeyJwk?: Record<string, unknown>
  ) {
    const { localUser, deviceId } = currentLocalIdentity();
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
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
    const { deviceIdentity } = useAppStore.getState();
    const sealedPayload = DeviceSealedPayload.safeParse(envelope.payload);
    if (deviceIdentity && sealedPayload.success) {
      try {
        return await openDeviceSealedJson<unknown>(sealedPayload.data, deviceIdentity.privateKeyJwk);
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
    const { deviceIdentity } = useAppStore.getState();
    const { deviceId } = currentLocalIdentity();
    const request = InviteJoinRequestPlaintextPayload.safeParse(plaintext);
    if (request.success) {
      appendInviteRequest(roomId, { ...request.data, status: "pending" });
      return;
    }
    const status = InviteJoinStatusPlaintextPayload.safeParse(plaintext);
    if (!status.success) return;
    const statusPayload = status.data;
    updateInviteRequestStatus(roomId, statusPayload.requestId, statusPayload.status);
    if (!statusPayload.requestId.startsWith(`${deviceId}:`)) return;
    if (
      statusPayload.status === "approved" &&
      statusPayload.wrappedRoomSecret &&
      statusPayload.recipientDeviceId === deviceId &&
      deviceIdentity
    ) {
      const secret = await unwrapRoomSecretForDevice(
        statusPayload.wrappedRoomSecret,
        deviceIdentity.privateKeyJwk
      );
      await importRoomSecret(roomId, secret);
      restoreForgottenRoom(roomId);
    }
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setInviteMessageForRoom(
        roomId,
        statusPayload.status === "approved"
          ? statusPayload.wrappedRoomSecret
            ? `${statusPayload.decidedBy} approved your room join request. This room is unlocked on this device.`
            : `${statusPayload.decidedBy} approved your room join request.`
          : `${statusPayload.decidedBy} denied your room join request.`
      );
    }
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    const context = currentSelectedRoomContext();
    if (!context) {
      setSelectedInviteMessage("Create or join a room before deciding invite requests.");
      return;
    }
    const { room: selectedRoom, isActiveHost, hostGateMessage, localUser, deviceId } = context;
    const appStore = useAppStore.getState();
    const isSelectedRoomRevoked =
      appStore.revokedRoomIds.has(selectedRoom.id) || appStore.revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || appStore.forgottenRoomIds.has(selectedRoom.id) || isSelectedRoomRevoked;
    const inviteRequests = appStore.inviteByRoom[selectedRoom.id]?.requests ?? [];
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
    const { relayStatus } = useAppStore.getState();
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

import {
  DeviceSealedPayload,
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  type RelayEnvelope
} from "@multaiplayer/protocol";
import {
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretAuthenticatedFromDevice,
  wrapRoomSecretAuthenticatedForDevice,
  fingerprintPublicKey,
  verifyInviteCapabilityMac,
  computeInviteCapabilityMac,
  type DeviceCryptoContext,
  type InviteCapabilityRequestBinding,
  type InviteCapabilityResponseBinding
} from "@multaiplayer/crypto";
import { importRoomSecret, loadOrCreateCurrentRoomKey } from "../localHistory";
import { canActOnRoomInviteRequest, findRoomInviteRequest, roomInviteRequestMessage } from "../inviteApproval";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { InviteJoinRequest } from "../../types";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoomContext } from "../selectedWorkspace";
import {
  consumeIssuedInviteCapability,
  consumePendingInviteCapability,
  loadIssuedInviteCapability,
  loadPendingInviteCapability,
  pinInviteDeviceKey,
  verifyIssuedInviteCapability
} from "../inviteCapabilityStore";

type InviteRelayActionOptions = Pick<UseInviteActionsOptions, "relayRef" | "seenEnvelopeIds" | "selectedRoomIdRef">;
const inviteDecisionsInFlight = new Set<string>();

type InviteRelayStore = Pick<
  AppStoreState,
  "appendInviteRequest" | "restoreForgottenRoom" | "setInviteMessageForRoom" | "updateInviteRequestStatus"
>;

export function createInviteRelayActions(
  options: InviteRelayActionOptions,
  store: InviteRelayStore = useAppStore.getState()
) {
  const { relayRef, seenEnvelopeIds, selectedRoomIdRef } = options;
  const { appendInviteRequest, restoreForgottenRoom, setInviteMessageForRoom, updateInviteRequestStatus } = store;
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
    if (!recipientPublicKeyJwk) return false;
    const cryptoContext: DeviceCryptoContext = {
      purpose: "invite-request",
      teamId,
      roomId,
      senderUserId: localUser.id,
      senderDeviceId: deviceId,
      recipientDeviceId: request.hostDeviceId
    };
    const payload = await sealJsonToDevice(request, recipientPublicKeyJwk, cryptoContext);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: request.requestedAt,
      kind: "room.invite",
      keyEpoch: request.keyEpoch,
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
        const { deviceId } = currentLocalIdentity();
        for (const purpose of ["invite-request", "invite-response"] as const) {
          try {
            return await openDeviceSealedJson<unknown>(sealedPayload.data, deviceIdentity.privateKeyJwk, {
              purpose,
              teamId: envelope.teamId,
              roomId: envelope.roomId,
              senderUserId: envelope.senderUserId,
              senderDeviceId: envelope.senderDeviceId,
              recipientDeviceId: deviceId
            });
          } catch {
            /* try the other authenticated invite purpose */
          }
        }
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function handleInviteEnvelopePlaintext(roomId: string, plaintext: unknown, envelope?: RelayEnvelope) {
    const { deviceIdentity } = useAppStore.getState();
    const { deviceId, localUser } = currentLocalIdentity();
    const request = InviteJoinRequestPlaintextPayload.safeParse(plaintext);
    if (request.success) {
      if (
        !envelope ||
        envelope.roomId !== roomId ||
        envelope.senderUserId !== request.data.requesterUserId ||
        envelope.senderDeviceId !== request.data.requesterDeviceId ||
        envelope.keyEpoch !== request.data.keyEpoch
      )
        return;
      const issued = request.data.inviteId ? loadIssuedInviteCapability(request.data.inviteId) : null;
      const fingerprint = await fingerprintPublicKey(request.data.requesterPublicKeyJwk);
      const localHostFingerprint = deviceIdentity ? await fingerprintPublicKey(deviceIdentity.publicKeyJwk) : null;
      if (
        !issued ||
        issued.teamId !== envelope.teamId ||
        issued.roomId !== roomId ||
        issued.keyEpoch !== request.data.keyEpoch ||
        issued.hostUserId !== request.data.hostUserId ||
        issued.hostDeviceId !== request.data.hostDeviceId ||
        issued.hostPublicKeyFingerprint !== request.data.hostPublicKeyFingerprint ||
        request.data.hostUserId !== localUser.id ||
        request.data.hostDeviceId !== deviceId ||
        !deviceIdentity ||
        localHostFingerprint !== request.data.hostPublicKeyFingerprint ||
        JSON.stringify(issued.hostPublicKeyJwk) !== JSON.stringify(deviceIdentity.publicKeyJwk) ||
        fingerprint !== request.data.requesterPublicKeyFingerprint
      )
        return;
      const binding: InviteCapabilityRequestBinding = {
        phase: "request",
        inviteId: request.data.inviteId!,
        teamId: envelope.teamId,
        roomId,
        keyEpoch: request.data.keyEpoch,
        requestId: request.data.id,
        requestNonce: request.data.requestNonce,
        requesterUserId: request.data.requesterUserId,
        requesterDeviceId: request.data.requesterDeviceId,
        requesterPublicKeyFingerprint: request.data.requesterPublicKeyFingerprint,
        hostUserId: request.data.hostUserId,
        hostDeviceId: request.data.hostDeviceId,
        hostPublicKeyFingerprint: request.data.hostPublicKeyFingerprint
      };
      if (
        !(await verifyIssuedInviteCapability(issued, request.data.capability)) ||
        !(await verifyInviteCapabilityMac(request.data.capability, binding, request.data.capabilityMac))
      )
        return;
      if (
        !pinInviteDeviceKey(
          roomId,
          request.data.requesterUserId,
          request.data.requesterDeviceId,
          fingerprint,
          request.data.requesterPublicKeyJwk
        )
      )
        return;
      appendInviteRequest(roomId, { ...request.data, status: "pending" });
      return;
    }
    const status = InviteJoinStatusPlaintextPayload.safeParse(plaintext);
    if (!status.success) return;
    const statusPayload = status.data;
    if (!envelope) return;
    const pending = loadPendingInviteCapability(statusPayload.requestId);
    if (
      !pending ||
      envelope.senderUserId !== pending.hostUserId ||
      envelope.senderDeviceId !== pending.hostDeviceId ||
      envelope.keyEpoch !== pending.keyEpoch ||
      statusPayload.decidedByUserId !== pending.hostUserId ||
      statusPayload.hostDeviceId !== pending.hostDeviceId ||
      statusPayload.hostPublicKeyFingerprint !== pending.hostPublicKeyFingerprint ||
      statusPayload.recipientUserId !== pending.requesterUserId ||
      statusPayload.recipientDeviceId !== pending.requesterDeviceId ||
      statusPayload.recipientPublicKeyFingerprint !== pending.requesterPublicKeyFingerprint ||
      statusPayload.requestNonce !== pending.requestNonce ||
      statusPayload.keyEpoch !== pending.keyEpoch ||
      (await fingerprintPublicKey(pending.hostPublicKeyJwk)) !== pending.hostPublicKeyFingerprint
    )
      return;
    const responseBinding: InviteCapabilityResponseBinding = {
      phase: "response",
      inviteId: pending.inviteId,
      teamId: pending.teamId,
      roomId: pending.roomId,
      keyEpoch: pending.keyEpoch,
      requestId: pending.requestId,
      requestNonce: pending.requestNonce,
      requesterUserId: pending.requesterUserId,
      requesterDeviceId: pending.requesterDeviceId,
      requesterPublicKeyFingerprint: pending.requesterPublicKeyFingerprint,
      hostUserId: pending.hostUserId,
      hostDeviceId: pending.hostDeviceId,
      hostPublicKeyFingerprint: pending.hostPublicKeyFingerprint,
      status: statusPayload.status,
      decidedAt: statusPayload.decidedAt
    };
    if (!(await verifyInviteCapabilityMac(pending.inviteCapability, responseBinding, statusPayload.capabilityMac)))
      return;
    if (!statusPayload.requestId.startsWith(`${deviceId}:`)) return;
    if (statusPayload.status === "approved") {
      if (!statusPayload.wrappedRoomSecret || statusPayload.recipientDeviceId !== deviceId || !deviceIdentity) return;
      if (
        !pinInviteDeviceKey(
          roomId,
          pending.hostUserId,
          pending.hostDeviceId,
          pending.hostPublicKeyFingerprint,
          pending.hostPublicKeyJwk
        )
      )
        return;
      const secret = await unwrapRoomSecretAuthenticatedFromDevice(
        statusPayload.wrappedRoomSecret,
        deviceIdentity.privateKeyJwk,
        pending.hostPublicKeyJwk,
        {
          purpose: "invite-response",
          teamId: envelope.teamId,
          roomId,
          senderUserId: envelope.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          recipientDeviceId: deviceId,
          requestId: pending.requestId,
          requestNonce: pending.requestNonce,
          keyEpoch: pending.keyEpoch
        }
      );
      await importRoomSecret(roomId, secret, statusPayload.keyEpoch);
      restoreForgottenRoom(roomId);
    }
    consumePendingInviteCapability(statusPayload.requestId);
    updateInviteRequestStatus(roomId, statusPayload.requestId, statusPayload.status);
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
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const decisionKey = roomRequest.inviteId ?? roomRequest.id;
    if (inviteDecisionsInFlight.has(decisionKey)) {
      setInviteMessageForRoom(selectedRoom.id, "This invite decision is already in progress.");
      return;
    }
    inviteDecisionsInFlight.add(decisionKey);
    try {
      if (!roomRequest.inviteId || !roomRequest.requesterPublicKeyJwk || !roomRequest.requesterPublicKeyFingerprint)
        throw new Error("Invite request is not capability authenticated");
      const issued = loadIssuedInviteCapability(roomRequest.inviteId);
      if (
        !issued ||
        !(await verifyIssuedInviteCapability(issued, roomRequest.capability)) ||
        issued.keyEpoch !== roomRequest.keyEpoch
      )
        throw new Error("Invite capability is no longer valid");
      const requestBinding: InviteCapabilityRequestBinding = {
        phase: "request",
        inviteId: roomRequest.inviteId,
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        keyEpoch: roomRequest.keyEpoch,
        requestId: roomRequest.id,
        requestNonce: roomRequest.requestNonce,
        requesterUserId: roomRequest.requesterUserId,
        requesterDeviceId: roomRequest.requesterDeviceId,
        requesterPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        hostUserId: roomRequest.hostUserId,
        hostDeviceId: roomRequest.hostDeviceId,
        hostPublicKeyFingerprint: roomRequest.hostPublicKeyFingerprint
      };
      if (!(await verifyInviteCapabilityMac(roomRequest.capability, requestBinding, roomRequest.capabilityMac))) {
        throw new Error("Invite request capability authentication failed");
      }
      if (
        (await fingerprintPublicKey(roomRequest.requesterPublicKeyJwk)) !== roomRequest.requesterPublicKeyFingerprint ||
        !pinInviteDeviceKey(
          selectedRoom.id,
          roomRequest.requesterUserId,
          roomRequest.requesterDeviceId,
          roomRequest.requesterPublicKeyFingerprint,
          roomRequest.requesterPublicKeyJwk
        )
      ) {
        throw new Error("Invite requester device key is not the validated pinned key");
      }
      if (
        !canActOnRoomInviteRequest(useAppStore.getState().inviteByRoom[selectedRoom.id]?.requests ?? [], roomRequest.id)
      ) {
        throw new Error("Invite request was already decided");
      }
      const currentKey = await loadOrCreateCurrentRoomKey(selectedRoom.id);
      if (currentKey.epoch !== issued.keyEpoch || currentKey.epoch !== roomRequest.keyEpoch) {
        throw new Error("Invite capability expired after room access changed");
      }
      const cryptoContext: DeviceCryptoContext = {
        purpose: "invite-response",
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        senderUserId: localUser.id,
        senderDeviceId: deviceId,
        recipientDeviceId: roomRequest.requesterDeviceId,
        requestId: roomRequest.id,
        requestNonce: roomRequest.requestNonce,
        keyEpoch: roomRequest.keyEpoch
      };
      const hostIdentity = useAppStore.getState().deviceIdentity;
      if (!hostIdentity) throw new Error("Host device identity is unavailable");
      const wrappedRoomSecret =
        status === "approved" && roomRequest.requesterPublicKeyJwk
          ? await wrapRoomSecretAuthenticatedForDevice(
              currentKey.secret,
              hostIdentity,
              roomRequest.requesterPublicKeyJwk,
              cryptoContext
            )
          : undefined;
      const decidedAt = new Date().toISOString();
      const responseBinding: InviteCapabilityResponseBinding = {
        phase: "response",
        inviteId: roomRequest.inviteId,
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        keyEpoch: roomRequest.keyEpoch,
        requestId: roomRequest.id,
        requestNonce: roomRequest.requestNonce,
        requesterUserId: roomRequest.requesterUserId,
        requesterDeviceId: roomRequest.requesterDeviceId,
        requesterPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        hostUserId: localUser.id,
        hostDeviceId: deviceId,
        hostPublicKeyFingerprint: issued.hostPublicKeyFingerprint,
        status,
        decidedAt
      };
      const payload: InviteJoinStatusPlaintextPayload = {
        eventType: "invite.status",
        requestId: roomRequest.id,
        status,
        decidedBy: localUser.name,
        decidedByUserId: localUser.id,
        decidedAt,
        recipientUserId: roomRequest.requesterUserId,
        recipientDeviceId: roomRequest.requesterDeviceId,
        recipientPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        hostDeviceId: deviceId,
        hostPublicKeyFingerprint: issued.hostPublicKeyFingerprint,
        requestNonce: roomRequest.requestNonce,
        keyEpoch: roomRequest.keyEpoch,
        capabilityMac: await computeInviteCapabilityMac(roomRequest.capability, responseBinding),
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
        keyEpoch: roomRequest.keyEpoch,
        payload: await sealJsonToDevice(payload, roomRequest.requesterPublicKeyJwk, cryptoContext)
      };
      await client.publishAndWaitForAck({ type: "publish", envelope });
      seenEnvelopeIds.current.add(envelope.id);
      consumeIssuedInviteCapability(roomRequest.inviteId);
      updateInviteRequestStatus(selectedRoom.id, roomRequest.id, status);
      setInviteMessageForRoom(
        selectedRoom.id,
        `${status === "approved" ? "Approved" : "Denied"} ${roomRequest.requester}'s join request.`
      );
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, selectedRoom.id)) {
        setInviteMessageForRoom(selectedRoom.id, String(error));
      }
    } finally {
      inviteDecisionsInFlight.delete(decisionKey);
    }
  }

  return {
    decideInviteJoinRequest,
    decryptInviteEnvelope,
    handleInviteEnvelopePlaintext,
    publishInviteJoinRequest
  };
}

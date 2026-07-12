import { fingerprintPublicKey, unwrapRoomSecretAuthenticatedFromDevice, type RoomSecret } from "@multaiplayer/crypto";
import {
  HostHandoffPlaintextPayload,
  RoomKeyRotationPlaintextPayload,
  RoomSettingsPlaintextPayload,
  type RelayEnvelope
} from "@multaiplayer/protocol";
import { formatMessageTime } from "../../lib/appFormatters";
import { isDeviceKeyTrusted } from "../../lib/deviceTrust";
import { loadPinnedInviteDeviceKey } from "../../lib/inviteCapabilityStore";
import { installRoomSecretEpoch } from "../../lib/localHistory";
import { isRoomKeyRotationEnvelopeAuthorized } from "../../lib/roomKeyRotation";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  isEnvelopeFromHandoffInitiator,
  roomHostEnvelopeRejectionMessage
} from "../../lib/roomHost";
import { buildRoomSettingsSystemMessage } from "../../lib/roomSettingsMessages";
import { loadTeamDevices } from "../../lib/workspaceClient";
import { approvalDelegationPolicyLabels, approvalPolicyLabels, roomModeLabels } from "../../appDefaults";
import type { AppStoreState } from "../../store/appStore";
import type { RelayEnvelopeRouteContext, RelayEnvelopeStoreActions } from "./relayEnvelopeRouteTypes";

export async function routeRoomEnvelope(
  envelope: RelayEnvelope,
  context: RelayEnvelopeRouteContext,
  store: RelayEnvelopeStoreActions,
  getStore: () => AppStoreState,
  _secret: RoomSecret,
  decrypt: () => Promise<unknown>
): Promise<boolean> {
  const roomId = envelope.roomId;
  if (envelope.kind === "room.host") {
    const parsed = HostHandoffPlaintextPayload.safeParse(await decrypt());
    if (!parsed.success) return true;
    const plaintext = parsed.data;
    if (plaintext.status === "accepted") {
      const room = findEnvelopeRoom(context.roomsRef.current, roomId);
      const availableHandoff = getStore().codexRuntimeByRoom[roomId]?.hostHandoffs?.find(
        (handoff) => handoff.id === plaintext.id && handoff.status === "available"
      );
      const matchesAvailableHandoff = Boolean(
        availableHandoff &&
        availableHandoff.fromUserId === plaintext.fromUserId &&
        availableHandoff.fromHost === plaintext.fromHost
      );
      if (
        plaintext.acceptedByUserId !== envelope.senderUserId ||
        !isEnvelopeFromActiveRoomHost(room, envelope) ||
        !matchesAvailableHandoff
      )
        store.setHostMessageForRoom(
          roomId,
          "Rejected host handoff acceptance because it was not bound to the active host and matching available handoff."
        );
      else {
        store.applyAcceptedHostHandoffForRoom(roomId, { ...plaintext, status: "accepted" });
        store.setHostMessageForRoom(
          roomId,
          `${plaintext.acceptedBy ?? "A room member"} accepted host handoff from ${plaintext.fromHost}.`
        );
      }
      return true;
    }
    const room = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (!isEnvelopeFromHandoffInitiator(room, envelope) || plaintext.fromUserId !== envelope.senderUserId)
      store.setHostMessageForRoom(roomId, roomHostEnvelopeRejectionMessage(room, "host handoff"));
    else store.appendHostHandoff(roomId, { ...plaintext, status: "available" });
    return true;
  }
  if (envelope.kind === "room.settings") {
    const parsed = RoomSettingsPlaintextPayload.safeParse(await decrypt());
    if (!parsed.success) return true;
    const room = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (isEnvelopeFromActiveRoomHost(room, envelope) && parsed.data.changedByUserId === envelope.senderUserId) {
      store.appendRoomMessage(
        roomId,
        buildRoomSettingsSystemMessage(parsed.data, {
          approvalPolicyLabels,
          approvalDelegationPolicyLabels,
          roomModeLabels
        })
      );
    }
    return true;
  }
  if (envelope.kind !== "room.key") return false;
  const parsed = RoomKeyRotationPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return true;
  const plaintext = parsed.data;
  const room = findEnvelopeRoom(context.roomsRef.current, roomId);
  if (!isRoomKeyRotationEnvelopeAuthorized(room, envelope, plaintext)) {
    store.setInviteMessageForRoom(roomId, roomHostEnvelopeRejectionMessage(room, "room access refresh"));
    return true;
  }
  if (plaintext.previousEpoch !== envelope.keyEpoch) return true;
  const identity = getStore().deviceIdentity;
  if (!identity) return true;
  const recipient = plaintext.recipients.find(
    (item) =>
      item.userId === context.localUser.id &&
      item.deviceId === context.deviceId &&
      item.publicKeyFingerprint === identity.publicKeyFingerprint
  );
  if (!recipient) return true;
  const hostDevice = (await loadTeamDevices(envelope.teamId)).find(
    (device) => device.userId === envelope.senderUserId && device.deviceId === envelope.senderDeviceId
  );
  if (!hostDevice) return true;
  const pin = loadPinnedInviteDeviceKey(roomId, envelope.senderUserId, envelope.senderDeviceId);
  const expectedHostKey = pin?.jwk ?? hostDevice.publicKeyJwk;
  const fingerprint = await fingerprintPublicKey(expectedHostKey as JsonWebKey);
  const pinValid = pin?.fingerprint === fingerprint;
  const trusted =
    fingerprint === hostDevice.publicKeyFingerprint &&
    isDeviceKeyTrusted(getStore().trustedDeviceKeys, roomId, hostDevice.deviceId, fingerprint);
  if (!pinValid && !trusted) return true;
  const newSecret = await unwrapRoomSecretAuthenticatedFromDevice(
    recipient.wrappedRoomSecret,
    identity.privateKeyJwk,
    expectedHostKey as JsonWebKey,
    {
      purpose: "room-key-rotation",
      teamId: envelope.teamId,
      roomId,
      senderUserId: envelope.senderUserId,
      senderDeviceId: envelope.senderDeviceId,
      recipientDeviceId: context.deviceId,
      operationId: plaintext.id,
      keyEpoch: envelope.keyEpoch,
      previousEpoch: plaintext.previousEpoch,
      newEpoch: plaintext.newEpoch
    }
  );
  await installRoomSecretEpoch(roomId, plaintext.newEpoch, newSecret);
  context.historyLoadedRoomIds.current.add(roomId);
  store.restoreForgottenRoom(roomId);
  store.appendRoomMessage(roomId, {
    id: plaintext.id,
    author: "multAIplayer",
    role: "system",
    body: `${plaintext.rotatedBy} refreshed room access. Future messages and invites use the updated access state.`,
    time: formatMessageTime(plaintext.rotatedAt),
    createdAt: plaintext.rotatedAt
  });
  store.setInviteMessageForRoom(roomId, `${plaintext.rotatedBy} refreshed room access for future messages.`);
  return true;
}

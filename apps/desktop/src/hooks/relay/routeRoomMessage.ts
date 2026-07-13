import {
  HostHandoffAcceptedPlaintextPayload,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  RoomSettingsPlaintextPayload
} from "@multaiplayer/protocol";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  isEnvelopeFromHandoffInitiator,
  roomHostEnvelopeRejectionMessage
} from "../../lib/roomHost";
import { buildRoomSettingsSystemMessage } from "../../lib/roomSettingsMessages";
import { approvalDelegationPolicyLabels, approvalPolicyLabels, roomModeLabels } from "../../appDefaults";
import type { AppStoreState } from "../../store/appStore";
import type { MlsMessageRouteContext, MlsMessageStoreActions, RoutedMlsMessage } from "./mlsMessageRouteTypes";

export async function routeRoomMessage(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  getStore: () => AppStoreState,
  decrypt: () => Promise<unknown>
): Promise<boolean> {
  const roomId = envelope.roomId;
  if (envelope.kind === "room.host.request") {
    const parsed = HostHandoffRequestPlaintextPayload.safeParse(await decrypt());
    if (!parsed.success) return true;
    const room = findEnvelopeRoom(context.roomsRef.current, roomId);
    const offer = getStore().codexRuntimeByRoom[roomId]?.hostHandoffs?.find(
      (handoff) => handoff.id === parsed.data.offerId && handoff.status === "available"
    );
    if (
      !offer ||
      offer.fromUserId !== room?.hostUserId ||
      parsed.data.candidateUserId !== envelope.senderUserId ||
      parsed.data.candidateDeviceId !== envelope.senderDeviceId
    )
      return true;
    store.markHostHandoffRequestedForRoom(roomId, offer.id, {
      candidateUserId: parsed.data.candidateUserId,
      candidateDeviceId: parsed.data.candidateDeviceId,
      candidateLeaf: parsed.data.candidateLeaf
    });
    store.setHostMessageForRoom(
      roomId,
      "A verified room member requested host authority. The active host must approve the MLS transfer."
    );
    return true;
  }
  if (envelope.kind === "room.host.accepted") {
    const parsed = HostHandoffAcceptedPlaintextPayload.safeParse(await decrypt());
    if (!parsed.success) return true;
    const offer = getStore().codexRuntimeByRoom[roomId]?.hostHandoffs?.find(
      (handoff) => handoff.id === parsed.data.offerId && handoff.fromUserId === envelope.senderUserId
    );
    if (
      !offer ||
      offer.status !== "requested" ||
      offer.candidateUserId !== parsed.data.hostUserId ||
      offer.candidateDeviceId !== parsed.data.hostDeviceId ||
      offer.candidateLeaf !== parsed.data.hostLeaf
    )
      return true;
    store.applyAcceptedHostHandoffForRoom(roomId, {
      ...offer,
      status: "accepted",
      acceptedByUserId: parsed.data.hostUserId,
      acceptedAt: envelope.createdAt
    });
    store.setHostMessageForRoom(
      roomId,
      "MLS host authority transfer committed. The new host may now apply the verified local handoff context."
    );
    return true;
  }
  if (envelope.kind === "room.host") {
    const parsed = HostHandoffPlaintextPayload.safeParse(await decrypt());
    if (!parsed.success) return true;
    const plaintext = parsed.data;
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
  return false;
}

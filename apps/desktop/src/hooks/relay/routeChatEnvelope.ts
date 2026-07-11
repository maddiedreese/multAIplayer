import {
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  type RelayEnvelope
} from "@multaiplayer/protocol";
import { normalizeChatMessage } from "../../lib/chatSanitizer";
import { plaintextUserMatchesEnvelope } from "../../lib/encryptedEnvelope";
import { isLegacyDebugChatMessage } from "../../lib/localRoomHistoryPayload";
import { sendRoomMessageNotification } from "../../lib/roomNotifications";
import type { AppStoreState } from "../../store/appStore";
import type { ChatMessage } from "../../types";
import type { RelayEnvelopeRouteContext, RelayEnvelopeStoreActions } from "./relayEnvelopeRouteTypes";

export async function routeChatEnvelope(
  envelope: RelayEnvelope,
  context: RelayEnvelopeRouteContext,
  store: RelayEnvelopeStoreActions,
  getStore: () => AppStoreState,
  decrypt: () => Promise<unknown>
): Promise<boolean> {
  const roomId = envelope.roomId;
  if (envelope.kind === "chat.message") {
    const parsed = ChatPlaintextPayload.safeParse(await decrypt());
    if (
      !parsed.success ||
      !parsed.data.authorUserId ||
      !plaintextUserMatchesEnvelope(envelope, parsed.data.authorUserId)
    )
      return true;
    const message = normalizeChatMessage(parsed.data) as ChatMessage | null;
    if (!message || isLegacyDebugChatMessage(message)) return true;
    context.markIncomingChatUnread(
      roomId,
      context.selectedRoomIdRef.current,
      envelope.senderDeviceId,
      context.deviceId
    );
    store.appendRoomMessage(roomId, message);
    const room = context.roomsRef.current.find((item) => item.id === roomId);
    const access = getStore();
    void sendRoomMessageNotification({
      relayOpen: true,
      room,
      message,
      selectedRoomId: context.selectedRoomIdRef.current,
      localDeviceId: context.deviceId,
      senderDeviceId: envelope.senderDeviceId,
      localUserId: context.localUser.id,
      senderUserId: envelope.senderUserId,
      mutedRoomIds: new Set(
        Object.entries(access.roomSettingsByRoom)
          .filter(([, value]) => value.notificationsMuted)
          .map(([id]) => id)
      ),
      forgottenRoomIds: access.forgottenRoomIds,
      revokedRoomIds: access.revokedRoomIds,
      revokedTeamIds: access.revokedTeamIds
    }).catch(() => console.warn("Failed to send room notification"));
    if (room) context.handleCodexBrowserOpenCommand(message, room);
    return true;
  }
  if (envelope.kind === "chat.reaction") {
    const parsed = ChatReactionPlaintextPayload.safeParse(await decrypt());
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.reactorUserId))
      store.applyMessageReaction(roomId, parsed.data);
    return true;
  }
  if (envelope.kind === "chat.edit") {
    const parsed = ChatEditPlaintextPayload.safeParse(await decrypt());
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.editedByUserId))
      store.editRoomMessage(roomId, parsed.data);
    return true;
  }
  if (envelope.kind === "chat.delete") {
    const parsed = ChatDeletePlaintextPayload.safeParse(await decrypt());
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.deletedByUserId))
      store.deleteRoomMessage(roomId, parsed.data);
    return true;
  }
  return false;
}

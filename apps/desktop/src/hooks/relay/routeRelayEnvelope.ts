import type { RelayEnvelope } from "@multaiplayer/protocol";
import { decryptRoomEnvelope } from "../../lib/encryptedEnvelope";
import { loadRoomSecret } from "../../lib/localHistory";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import { routeActivityEnvelope, handleCodexQueueEvent } from "./routeActivityEnvelope";
import { routeChatEnvelope } from "./routeChatEnvelope";
import { routeRoomEnvelope } from "./routeRoomEnvelope";
import type { RelayEnvelopeRouteContext } from "./relayEnvelopeRouteTypes";

export type { RelayEnvelopeRouteContext } from "./relayEnvelopeRouteTypes";
export { handleCodexQueueEvent };

export async function routeRelayEnvelope(
  envelope: RelayEnvelope,
  context: RelayEnvelopeRouteContext,
  getStore: () => AppStoreState = useAppStore.getState
): Promise<void> {
  if (envelope.kind === "room.invite") {
    const plaintext = await context.decryptInviteEnvelope(envelope);
    if (plaintext) await context.handleInviteEnvelopePlaintext(envelope.roomId, plaintext, envelope);
    return;
  }
  if (envelope.payload.algorithm !== "AES-GCM-256") return;
  const roomPayload = envelope.payload;
  const secret = await loadRoomSecret(envelope.roomId, envelope.keyEpoch);
  if (!secret) {
    getStore().rememberForgottenRoom(envelope.roomId);
    return;
  }
  const store = getStore();
  const decrypt = () => decryptRoomEnvelope<unknown>({ ...envelope, payload: roomPayload }, secret);
  if (await routeChatEnvelope(envelope, context, store, getStore, decrypt)) return;
  if (await routeActivityEnvelope(envelope, store, decrypt)) return;
  await routeRoomEnvelope(envelope, context, store, getStore, secret, decrypt);
}

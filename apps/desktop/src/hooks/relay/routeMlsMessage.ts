import type { MlsRelayMessage } from "@multaiplayer/protocol";
import { decodeMlsApplicationMessage } from "../../lib/mlsApplicationMessage";
import { mlsGroupState, parseMlsAuthenticatedData, processMlsIncoming } from "../../lib/mlsClient";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import { routeActivityMessage, handleCodexQueueEvent } from "./routeActivityMessage";
import { routeChatMessage } from "./routeChatMessage";
import { routeRoomMessage } from "./routeRoomMessage";
import type { MlsMessageRouteContext } from "./mlsMessageRouteTypes";

export type { MlsMessageRouteContext } from "./mlsMessageRouteTypes";
export { handleCodexQueueEvent };

export async function routeMlsMessage(
  envelope: MlsRelayMessage,
  context: MlsMessageRouteContext,
  getStore: () => AppStoreState = useAppStore.getState
): Promise<void> {
  const incoming = await processMlsIncoming(envelope.roomId, envelope.mlsMessage);
  if (!incoming) return;
  const authenticatedData = parseMlsAuthenticatedData(incoming.authenticatedData);
  const state = await mlsGroupState(envelope.roomId);
  const sender = state.roster.find((member) => member.leaf === incoming.senderLeaf);
  if (
    !authenticatedData ||
    !sender ||
    sender.githubUserId !== envelope.senderUserId ||
    sender.deviceId !== envelope.senderDeviceId ||
    authenticatedData.messageId !== envelope.id ||
    authenticatedData.epoch !== incoming.epoch ||
    authenticatedData.epoch !== envelope.epochHint ||
    authenticatedData.teamId !== envelope.teamId ||
    authenticatedData.roomId !== envelope.roomId ||
    authenticatedData.senderUserId !== envelope.senderUserId ||
    authenticatedData.senderDeviceId !== envelope.senderDeviceId ||
    authenticatedData.createdAt !== envelope.createdAt
  )
    return;
  const routedEnvelope = { ...envelope, kind: authenticatedData.kind };
  const store = getStore();
  const decrypt = async () => decodeMlsApplicationMessage<unknown>(incoming);
  if (await routeChatMessage(routedEnvelope, context, store, getStore, decrypt)) return;
  if (await routeActivityMessage(routedEnvelope, store, decrypt)) return;
  await routeRoomMessage(routedEnvelope, context, store, getStore, decrypt);
}

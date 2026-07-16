import type { MlsRelayMessage, ClientRoomRecord } from "@multaiplayer/protocol";
import {
  authorizeMlsHostTransfer,
  listMlsOutbox,
  markMlsPublishSucceeded,
  parseMlsAuthenticatedData,
  retireStaleMlsApplication,
  type MlsOutboxItem
} from "../../lib/mls/mlsClient";
import { publishDirectedInviteResponse } from "../workspace/workspaceClient";
import { isExpiredMlsApplication, isStaleMlsPublish, type RelayClient } from "../../lib/relay/relayClient";
import { clearAndRebaseStaleMlsCommit } from "../../lib/mls/mlsCommitRebase";
import { useAppStore } from "../../store/appStore";
import { publishRoomConfigSnapshot } from "./roomConfigSnapshot";

interface LocalIdentity {
  userId: string;
  deviceId: string;
  deviceSessionToken: string;
}

export async function recoverRoomAfterJoin(
  client: RelayClient,
  room: ClientRoomRecord,
  identity: LocalIdentity,
  seenEnvelopeIds: Set<string>,
  dependencies: {
    drain?: typeof drainMlsOutboxForRoom;
    publishConfig?: typeof publishRoomConfigSnapshot;
  } = {}
): Promise<void> {
  await (dependencies.drain ?? drainMlsOutboxForRoom)(client, room, identity);
  if (
    room.hostStatus !== "active" ||
    room.hostUserId !== identity.userId ||
    room.activeHostDeviceId !== identity.deviceId ||
    !room.projectPath
  )
    return;
  await (dependencies.publishConfig ?? publishRoomConfigSnapshot)({
    client,
    room,
    senderUserId: identity.userId,
    senderDeviceId: identity.deviceId,
    seenEnvelopeIds,
    incrementRevision: true
  });
}

export async function drainMlsOutboxForRoom(
  client: RelayClient,
  room: ClientRoomRecord,
  identity: LocalIdentity
): Promise<void> {
  const items = (await listMlsOutbox())
    .filter((item) => item.roomId === room.id)
    .sort((left, right) => left.epoch - right.epoch || priority(left.kind) - priority(right.kind));

  for (const item of items) {
    if (await publishDirectedOutboxItem(item, room.id, identity.deviceId)) continue;
    const message = await relayMessageForOutboxItem(item, room, identity);

    try {
      await client.publishAndWaitForAck({ type: "publish", message });
      await markMlsPublishSucceeded(room.id, item.id);
    } catch (error) {
      if (message.messageType === "application" && isExpiredMlsApplication(error)) {
        await retireStaleMlsApplication(room.id, item.id);
        useAppStore
          .getState()
          .setHostMessageForRoom(
            room.id,
            "An encrypted message recovered from the durable outbox was not delivered before its MLS epoch expired. Resend it."
          );
        continue;
      }
      if (message.messageType === "commit" && isStaleMlsPublish(error))
        await clearAndRebaseStaleMlsCommit(client, room, identity, item.id);
      throw error;
    }
  }
}

async function publishDirectedOutboxItem(item: MlsOutboxItem, roomId: string, deviceId: string) {
  if (item.metadata?.type !== "welcome" && item.metadata?.type !== "inviteResponse") return false;
  const inviteId = item.metadata.type === "welcome" ? item.metadata.inviteId : item.metadata.binding.inviteId;
  const requestId = item.metadata.type === "welcome" ? item.metadata.requestId : item.metadata.binding.requestId;
  await publishDirectedInviteResponse(inviteId, {
    hostDeviceId: deviceId,
    requestId,
    status: item.metadata.type === "welcome" ? "approved" : "denied",
    responseBinding: (item.metadata.type === "welcome"
      ? item.metadata.responseBinding
      : item.metadata.binding) as never,
    responseMac: item.metadata.type === "welcome" ? item.metadata.responseMac : item.metadata.mac,
    ...(item.metadata.type === "welcome" ? { welcome: item.payload } : {})
  });
  await markMlsPublishSucceeded(roomId, item.id);
  return true;
}

async function relayMessageForOutboxItem(
  item: MlsOutboxItem,
  room: ClientRoomRecord,
  identity: LocalIdentity
): Promise<MlsRelayMessage> {
  if (item.metadata?.type === "application") return applicationRelayMessage(item, room.id);
  const transfer = item.metadata?.type === "hostTransfer" ? await authorizeMlsHostTransfer(room.id, item.id) : null;
  const parentEpoch =
    item.metadata?.type === "commit" || item.metadata?.type === "hostTransfer"
      ? item.metadata.parentEpoch
      : item.epoch - 1;
  return {
    id: item.id,
    teamId: room.teamId,
    roomId: room.id,
    senderUserId: identity.userId,
    senderDeviceId: identity.deviceId,
    createdAt: new Date().toISOString(),
    messageType: "commit",
    epochHint: parentEpoch,
    mlsMessage: item.payload,
    ...(transfer
      ? {
          commitEffect: "host_handoff" as const,
          nextHostUserId: transfer.authorization.nextHostUserId,
          nextHostDeviceId: transfer.authorization.nextHostDeviceId,
          hostTransferAuthorization: {
            ...transfer.authorization,
            signatureDer: transfer.signatureDer,
            publicKeySpkiDer: transfer.publicKeySpkiDer
          }
        }
      : {})
  };
}

function applicationRelayMessage(item: MlsOutboxItem, roomId: string): MlsRelayMessage {
  if (item.metadata?.type !== "application") throw new Error("Expected an MLS application outbox record.");
  const authenticatedData = parseMlsAuthenticatedData(decodeUtf8(item.metadata.authenticatedData));
  if (!authenticatedData || authenticatedData.messageId !== item.id || authenticatedData.roomId !== roomId) {
    throw new Error("A durable MLS application outbox record has invalid authenticated routing data.");
  }
  return {
    id: item.id,
    teamId: authenticatedData.teamId,
    roomId: authenticatedData.roomId,
    senderUserId: authenticatedData.senderUserId,
    senderDeviceId: authenticatedData.senderDeviceId,
    createdAt: authenticatedData.createdAt,
    messageType: "application",
    epochHint: authenticatedData.epoch,
    mlsMessage: item.payload
  };
}

export async function pendingMlsOutboxRoomIds(): Promise<string[]> {
  return Array.from(new Set((await listMlsOutbox()).map((item) => item.roomId))).sort();
}

function priority(kind: string): number {
  if (kind === "application") return 0;
  if (kind === "welcome" || kind === "invite-denial") return 2;
  return 1;
}

function decodeUtf8(bytes: number[]): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
}

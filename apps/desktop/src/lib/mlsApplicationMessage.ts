import type { MlsRelayMessage } from "@multaiplayer/protocol";
import {
  decodeMlsApplicationPayload,
  encryptMlsApplication,
  markMlsPublishSucceeded,
  retireStaleMlsApplication,
  type MlsIncomingApplication
} from "./mlsClient";
import type { RelayClient } from "./relayClient";
import { isExpiredMlsApplication } from "./relayClient";
import { useAppStore } from "../store/appStore";

export interface MlsApplicationFields {
  id: string;
  teamId: string;
  roomId: string;
  senderDeviceId: string;
  senderUserId: string;
  createdAt: string;
  kind: string;
}

export async function createMlsApplicationMessage(
  fields: MlsApplicationFields,
  plaintext: unknown
): Promise<MlsRelayMessage> {
  const encrypted = await encryptMlsApplication(
    fields.roomId,
    {
      version: 1,
      messageId: fields.id,
      teamId: fields.teamId,
      roomId: fields.roomId,
      kind: fields.kind,
      senderUserId: fields.senderUserId,
      senderDeviceId: fields.senderDeviceId,
      createdAt: fields.createdAt
    },
    plaintext
  );
  if (encrypted.outboxId !== fields.id)
    throw new Error("Native MLS outbox did not preserve the authenticated relay message id.");
  return {
    id: fields.id,
    teamId: fields.teamId,
    roomId: fields.roomId,
    senderDeviceId: fields.senderDeviceId,
    senderUserId: fields.senderUserId,
    createdAt: fields.createdAt,
    messageType: "application",
    epochHint: encrypted.epoch,
    mlsMessage: encrypted.message
  };
}

export async function publishMlsApplicationMessage(client: RelayClient, message: MlsRelayMessage): Promise<void> {
  try {
    await client.publishAndWaitForAck({ type: "publish", message });
    await markMlsPublishSucceeded(message.roomId, message.id);
  } catch (error) {
    if (!isExpiredMlsApplication(error)) throw error;
    await retireStaleMlsApplication(message.roomId, message.id);
    useAppStore
      .getState()
      .setHostMessageForRoom(
        message.roomId,
        "An encrypted message was not delivered after its MLS epoch expired. Resend it."
      );
    throw new Error("MLS application epoch expired before relay delivery; resend the message.");
  }
}

export function decodeMlsApplicationMessage<T>(result: MlsIncomingApplication): T {
  return decodeMlsApplicationPayload(result.payload) as T;
}

export function plaintextUserMatchesEnvelope(
  envelope: Pick<MlsRelayMessage, "senderUserId">,
  plaintextUserId: string | undefined
): boolean {
  return plaintextUserId == null || plaintextUserId === envelope.senderUserId;
}

import { decryptJson, encryptJson, type RoomSecret } from "@multaiplayer/crypto";
import type { CiphertextPayload, RelayEnvelope, RoomEnvelopeMetadata, RoomRecord } from "@multaiplayer/protocol";
import { knownCurrentRoomKeyEpoch } from "./localHistory";

export type RoomEnvelopeFields = Omit<RoomEnvelopeMetadata, "keyEpoch"> & { keyEpoch?: number };

/** RoomRecord epoch storage is being introduced with rotation; epoch one is the only legacy room epoch. */
export function roomKeyEpoch(room: Pick<RoomRecord, "id"> & { keyEpoch?: number }): number {
  return knownCurrentRoomKeyEpoch(room.id);
}

export async function createEncryptedRoomEnvelope(
  fields: RoomEnvelopeFields,
  plaintext: unknown,
  secret: RoomSecret
): Promise<RelayEnvelope> {
  const metadata: RoomEnvelopeMetadata = { ...fields, keyEpoch: fields.keyEpoch ?? 1 };
  return { ...metadata, payload: await encryptJson(plaintext, secret, metadata) };
}

export async function decryptRoomEnvelope<T>(
  envelope: RelayEnvelope & { payload: CiphertextPayload },
  secret: RoomSecret
): Promise<T> {
  const { payload, ...metadata } = envelope;
  return decryptJson<T>(payload, secret, metadata);
}

export function plaintextUserMatchesEnvelope(
  envelope: Pick<RelayEnvelope, "senderUserId">,
  plaintextUserId: string | undefined
): boolean {
  return plaintextUserId == null || plaintextUserId === envelope.senderUserId;
}

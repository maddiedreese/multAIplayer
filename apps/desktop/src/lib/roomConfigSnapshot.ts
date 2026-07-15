import { RoomConfigPlaintextPayload, type ClientRoomRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "./mlsApplicationMessage";
import { currentMlsEpoch, loadMlsRoomConfig } from "./mlsClient";
import type { RelayClient } from "./relayClient";

export function roomConfigPayload(
  room: ClientRoomRecord,
  emittingEpoch: number,
  configRevision = room.configRevision
): RoomConfigPlaintextPayload {
  return RoomConfigPlaintextPayload.parse({
    eventType: "room.config",
    configRevision,
    emittingEpoch,
    projectPath: room.projectPath,
    codexModel: room.codexModel,
    codexModelPolicy: room.codexModelPolicy,
    codexReasoningEffort: room.codexReasoningEffort,
    codexReasoningEffortPolicy: room.codexReasoningEffortPolicy,
    codexRawReasoningEnabled: room.codexRawReasoningEnabled,
    codexSpeed: room.codexSpeed,
    codexServiceTierPolicy: room.codexServiceTierPolicy,
    codexSandboxLevel: room.codexSandboxLevel
  });
}

export function shouldApplyRoomConfig(
  room: ClientRoomRecord,
  payload: RoomConfigPlaintextPayload,
  authenticatedEpoch: number
): boolean {
  if (payload.emittingEpoch !== authenticatedEpoch) return false;
  if (authenticatedEpoch < room.configEpoch) return false;
  return authenticatedEpoch > room.configEpoch || payload.configRevision > room.configRevision;
}

export function applyRoomConfig(
  room: ClientRoomRecord,
  payload: RoomConfigPlaintextPayload,
  authenticatedEpoch: number
): ClientRoomRecord {
  if (!shouldApplyRoomConfig(room, payload, authenticatedEpoch)) return room;
  const { eventType: _eventType, emittingEpoch: _emittingEpoch, ...config } = payload;
  return {
    ...room,
    ...config,
    configEpoch: authenticatedEpoch,
    configPending: false
  };
}

export async function resolveRoomConfigForPublish(
  room: ClientRoomRecord,
  load: (roomId: string) => Promise<unknown | null> = loadMlsRoomConfig
): Promise<ClientRoomRecord> {
  if (room.projectPath.length > 0) return room;
  const persisted = RoomConfigPlaintextPayload.safeParse(await load(room.id));
  if (!persisted.success) {
    throw new Error("This device no longer has the encrypted room configuration required to host this room.");
  }
  const { eventType: _eventType, emittingEpoch, ...config } = persisted.data;
  return { ...room, ...config, configEpoch: emittingEpoch, configPending: false };
}

/** Encrypts the complete snapshot before relay publication; only MLS ciphertext leaves this process. */
export async function publishRoomConfigSnapshot(input: {
  client: RelayClient;
  room: ClientRoomRecord;
  senderUserId: string;
  senderDeviceId: string;
  seenEnvelopeIds: Set<string>;
  incrementRevision?: boolean;
}): Promise<ClientRoomRecord> {
  const room = await resolveRoomConfigForPublish(input.room);
  const epoch = await currentMlsEpoch(room.id);
  const revision = input.incrementRevision ? room.configRevision + 1 : room.configRevision;
  const payload = roomConfigPayload(room, epoch, revision);
  const id = crypto.randomUUID();
  const envelope: MlsRelayMessage = await createMlsApplicationMessage(
    {
      id,
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: input.senderDeviceId,
      senderUserId: input.senderUserId,
      createdAt: new Date().toISOString(),
      kind: "room.config"
    },
    payload
  );
  input.seenEnvelopeIds.add(id);
  await publishMlsApplicationMessage(input.client, envelope);
  const updated = { ...room, configRevision: revision, configEpoch: epoch, configPending: false };
  useAppStore.getState().replaceRoomRecord(updated);
  return updated;
}

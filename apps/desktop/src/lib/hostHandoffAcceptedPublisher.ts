import type { ClientRoomRecord, HostHandoffAcceptedPlaintextPayload, MlsRelayMessage } from "@multaiplayer/protocol";
import type { MutableRefObject } from "react";
import type { HostHandoffRecord, RelayStatus } from "../types";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "./mlsApplicationMessage";
import type { RelayClient } from "./relayClient";

export async function publishHostHandoffAccepted(input: {
  room: ClientRoomRecord;
  handoff: HostHandoffRecord;
  hostLeaf: number;
  committedEpoch: number;
  localUserId: string;
  deviceId: string;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
}): Promise<void> {
  const client = input.relayRef.current;
  if (!client || input.relayStatus === "closed" || input.relayStatus === "error") return;
  const acceptedAt = new Date().toISOString();
  const payload: HostHandoffAcceptedPlaintextPayload = {
    phase: "accepted",
    offerId: input.handoff.id,
    hostUserId: input.handoff.candidateUserId!,
    hostDeviceId: input.handoff.candidateDeviceId!,
    hostLeaf: input.hostLeaf,
    committedEpoch: input.committedEpoch
  };
  const envelope: MlsRelayMessage = await createMlsApplicationMessage(
    {
      id: crypto.randomUUID(),
      teamId: input.room.teamId,
      roomId: input.room.id,
      senderDeviceId: input.deviceId,
      senderUserId: input.localUserId,
      createdAt: acceptedAt,
      kind: "room.host.accepted"
    },
    payload
  );
  input.seenEnvelopeIds.current.add(envelope.id);
  await publishMlsApplicationMessage(client, envelope);
}

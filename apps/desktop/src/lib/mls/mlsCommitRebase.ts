import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { clearPendingMlsCommit } from "./mlsClient";
import type { RelayClient } from "../relay/relayClient";

export async function clearAndRebaseStaleMlsCommit(
  client: RelayClient,
  room: ClientRoomRecord,
  identity: { userId: string; deviceId: string; deviceSessionToken: string },
  messageId: string,
  dependencies: { clear?: typeof clearPendingMlsCommit } = {}
): Promise<void> {
  await (dependencies.clear ?? clearPendingMlsCommit)(room.id, messageId);
  await client.rejoinForBacklog({
    type: "join",
    teamId: room.teamId,
    roomId: room.id,
    userId: identity.userId,
    deviceId: identity.deviceId,
    deviceSessionToken: identity.deviceSessionToken
  });
}

import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { clearPendingMlsCommit, currentMlsEpoch } from "./mlsClient";
import type { RelayClient } from "../relay/relayClient";

export async function clearAndRebaseStaleMlsCommit(
  client: RelayClient,
  room: ClientRoomRecord,
  identity: { userId: string; deviceId: string; deviceSessionToken: string },
  messageId: string,
  parentEpoch: number
): Promise<void> {
  await clearPendingMlsCommit(room.id, messageId);
  await client.joinAndWaitForAck({
    type: "join",
    teamId: room.teamId,
    roomId: room.id,
    userId: identity.userId,
    deviceId: identity.deviceId,
    deviceSessionToken: identity.deviceSessionToken
  });
  const deadline = Date.now() + 5_000;
  while ((await currentMlsEpoch(room.id)) <= parentEpoch) {
    if (Date.now() >= deadline) throw new Error("MLS stale-epoch rebase did not receive the accepted Commit backlog.");
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
}

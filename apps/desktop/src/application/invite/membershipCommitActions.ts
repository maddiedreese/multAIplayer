import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { markMlsPublishSucceeded, mlsGroupState, removeMlsMember } from "../../lib/mls/mlsClient";
import { clearAndRebaseStaleMlsCommit } from "../../lib/mls/mlsCommitRebase";
import { useAppStore } from "../../store/appStore";
import { isStaleMlsPublish } from "../../lib/relay/relayClient";
import type { UseInviteActionsOptions } from "./inviteActionTypes";

type RoomMembershipActionOptions = Pick<
  UseInviteActionsOptions,
  "relayRef" | "reportMembershipCommitInFlight" | "seenEnvelopeIds"
>;

/** Publishes host-authorized MLS Remove commits with persist-before-send ordering. */
export function createMembershipCommitActions(options: RoomMembershipActionOptions) {
  async function removeMembersFromMlsGroup(
    room: ClientRoomRecord,
    localUser: { id: string; name: string },
    deviceId: string,
    excludedUserIds: ReadonlySet<string> = new Set<string>()
  ): Promise<void> {
    if (excludedUserIds.size === 0) return;
    if (options.reportMembershipCommitInFlight(room.id))
      throw new Error("Room membership commit is already in progress.");
    const client = options.relayRef.current;
    if (!client) throw new Error("Relay is unavailable for the membership commit.");
    const state = await mlsGroupState(room.id);
    const removed = state.roster.filter((member) => excludedUserIds.has(member.githubUserId));
    for (const member of removed) {
      const commit = await removeMlsMember(room.id, member.leaf);
      const envelope = {
        id: commit.outboxId,
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        messageType: "commit" as const,
        epochHint: commit.parentEpoch,
        mlsMessage: commit.message
      };
      options.seenEnvelopeIds.current.add(envelope.id);
      try {
        await client.publishAndWaitForAck({ type: "publish", message: envelope });
        await markMlsPublishSucceeded(room.id, commit.outboxId);
      } catch (error) {
        options.seenEnvelopeIds.current.delete(envelope.id);
        if (isStaleMlsPublish(error)) {
          const token = useAppStore.getState().deviceSessionToken;
          if (!token) throw new Error("Device session expired before MLS stale-epoch rebase.");
          await clearAndRebaseStaleMlsCommit(
            client,
            room,
            { userId: localUser.id, deviceId, deviceSessionToken: token },
            commit.outboxId
          );
        }
        throw error;
      }
    }
  }

  return { removeMembersFromMlsGroup };
}

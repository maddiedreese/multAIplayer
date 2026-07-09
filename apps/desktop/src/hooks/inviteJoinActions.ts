import type { InviteJoinRequestPlaintextPayload } from "@multaiplayer/protocol";
import { decodeRoomInviteSecret } from "@multaiplayer/crypto";
import { importRoomSecret } from "../lib/localHistory";
import { lookupInvite } from "../lib/workspaceClient";
import { decodeNoSecretRoomInvite } from "../lib/noSecretRoomInvite";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import {
  buildFallbackInvitedRoom,
  buildPendingInviteJoinRequest,
  inviteJoinRequestPlaintext,
  parseInviteInput
} from "../lib/inviteActionsHelpers";
import type {
  InviteAdmissionStoreActions,
  UseInviteActionsOptions
} from "./inviteActionTypes";

type PublishInviteJoinRequest = (
  teamId: string,
  roomId: string,
  request: InviteJoinRequestPlaintextPayload,
  recipientPublicKeyJwk?: Record<string, unknown>
) => Promise<boolean>;

type InviteJoinActionOptions = Pick<
  UseInviteActionsOptions,
  | "appendInviteRequest"
  | "clearInviteSecretInput"
  | "deviceId"
  | "deviceIdentity"
  | "inviteSecretInput"
  | "localUser"
  | "restoreForgottenRoom"
  | "restoreWorkspaceAccess"
  | "selectWorkspaceRoom"
  | "setInviteMessageForRoom"
  | "setSelectedInviteMessage"
  | "upsertRoom"
  | "upsertTeam"
> &
  InviteAdmissionStoreActions & {
    publishInviteJoinRequest: PublishInviteJoinRequest;
  };

export function createInviteJoinActions(options: InviteJoinActionOptions) {
  const {
    appendInviteRequest,
    clearInviteSecretInput,
    deviceId,
    deviceIdentity,
    initializeMessagesForRoom,
    inviteSecretInput,
    localUser,
    publishInviteJoinRequest,
    restoreForgottenRoom,
    restoreWorkspaceAccess,
    selectWorkspaceRoom,
    setInviteAdmissionForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage,
    upsertRoom,
    upsertTeam
  } = options;

  function importInviteMetadata({
    teamId,
    roomId,
    roomName
  }: {
    teamId: string;
    roomId: string;
    roomName: string;
  }) {
    upsertTeam({ id: teamId, name: "Invited team", members: 1 });
    upsertRoom(buildFallbackInvitedRoom({ teamId, roomId, roomName }));
  }

  async function requestNoSecretInviteAccess(encodedInvite: string, inviteId?: string | null) {
    const inviteSecret = decodeNoSecretRoomInvite(encodedInvite);
    let acceptedRoomName = inviteSecret.roomName;
    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match the no-secret invite fragment.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      restoreWorkspaceAccess(inviteSecret.teamId, inviteSecret.roomId);
      setInviteAdmissionForRoom(inviteSecret.roomId, inviteId);
    } else {
      importInviteMetadata(inviteSecret);
    }

    initializeMessagesForRoom(inviteSecret.roomId);
    selectWorkspaceRoom(inviteSecret.teamId, inviteSecret.roomId);
    clearInviteSecretInput();
    const request = buildPendingInviteJoinRequest({
      deviceId,
      deviceIdentity,
      inviteId,
      localUser,
      roomName: acceptedRoomName
    });
    appendInviteRequest(inviteSecret.roomId, request);
    const published = await publishInviteJoinRequest(
      inviteSecret.teamId,
      inviteSecret.roomId,
      inviteJoinRequestPlaintext(request),
      inviteSecret.hostPublicKeyJwk
    );
    setInviteMessageForRoom(
      inviteSecret.roomId,
      published
        ? `Requested access to ${acceptedRoomName}. The host needs to approve this device before the room unlocks.`
        : `Imported ${acceptedRoomName} metadata. Send again after the relay reconnects so the host can approve access.`
    );
  }

  async function acceptInvite(encodedSecret: string, inviteId?: string | null, approvalRequested = false) {
    const inviteSecret = decodeRoomInviteSecret(encodedSecret);
    let acceptedRoomName = inviteSecret.roomName;
    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match this invite.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      restoreWorkspaceAccess(inviteSecret.teamId, inviteSecret.roomId);
    } else {
      importInviteMetadata(inviteSecret);
    }

    await importRoomSecret(inviteSecret.roomId, inviteSecret.secret);
    restoreForgottenRoom(inviteSecret.roomId);
    if (inviteId) setInviteAdmissionForRoom(inviteSecret.roomId, inviteId);
    initializeMessagesForRoom(inviteSecret.roomId);
    selectWorkspaceRoom(inviteSecret.teamId, inviteSecret.roomId);
    clearInviteSecretInput();
    if (approvalRequested) {
      const request = buildPendingInviteJoinRequest({
        deviceId,
        deviceIdentity,
        inviteId,
        localUser,
        roomName: acceptedRoomName
      });
      appendInviteRequest(inviteSecret.roomId, request);
      const published = await publishInviteJoinRequest(
        inviteSecret.teamId,
        inviteSecret.roomId,
        inviteJoinRequestPlaintext(request)
      );
      setInviteMessageForRoom(
        inviteSecret.roomId,
        published
          ? `Imported ${acceptedRoomName} and sent a join request to the active host.`
          : `Imported ${acceptedRoomName}. Send again after the relay reconnects so the host can approve access.`
      );
      return;
    }
    setInviteMessageForRoom(inviteSecret.roomId, `Joined ${acceptedRoomName}.`);
  }

  async function joinInviteSecret() {
    const raw = inviteSecretInput.trim();
    if (!raw) return;
    setSelectedInviteMessage(null);
    clearInviteSecretInput();
    try {
      const { approvalRequested, encodedInvite, inviteId, joinInvite } = parseInviteInput(raw);
      if (joinInvite) {
        await requestNoSecretInviteAccess(joinInvite, inviteId);
        return;
      }
      await acceptInvite(encodedInvite, inviteId, approvalRequested);
    } catch (error) {
      setSelectedInviteMessage(`Invite could not be imported: ${String(error)}`);
    }
  }

  return { acceptInvite, joinInviteSecret, requestNoSecretInviteAccess };
}

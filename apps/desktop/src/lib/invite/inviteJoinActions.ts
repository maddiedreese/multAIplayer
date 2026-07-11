import type { InviteJoinRequestPlaintextPayload } from "@multaiplayer/protocol";
import { lookupInvite } from "../workspaceClient";
import { decodeNoSecretRoomInvite } from "../noSecretRoomInvite";
import { ensureRoomDefaults } from "../roomDefaults";
import {
  buildFallbackInvitedRoom,
  buildPendingInviteJoinRequest,
  inviteJoinRequestPlaintext,
  parseInviteInput
} from "../inviteActionsHelpers";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity } from "../selectedWorkspace";
import { rememberPendingInviteCapability } from "../inviteCapabilityStore";
import { fingerprintPublicKey } from "@multaiplayer/crypto";

type PublishInviteJoinRequest = (
  teamId: string,
  roomId: string,
  request: InviteJoinRequestPlaintextPayload,
  recipientPublicKeyJwk?: Record<string, unknown>
) => Promise<boolean>;

type InviteJoinActionOptions = Pick<
  UseInviteActionsOptions,
  "clearInviteSecretInput" | "selectedRoomIdRef" | "selectWorkspaceRoom" | "upsertRoom" | "upsertTeam"
> & {
  publishInviteJoinRequest: PublishInviteJoinRequest;
};

type InviteJoinStore = Pick<
  AppStoreState,
  | "appendInviteRequest"
  | "initializeMessagesForRoom"
  | "restoreWorkspaceAccess"
  | "setInviteAdmissionForRoom"
  | "setInviteMessageForRoom"
>;

export function createInviteJoinActions(
  options: InviteJoinActionOptions,
  store: InviteJoinStore = useAppStore.getState()
) {
  const { clearInviteSecretInput, publishInviteJoinRequest, selectWorkspaceRoom, upsertRoom, upsertTeam } = options;
  const {
    appendInviteRequest,
    initializeMessagesForRoom,
    restoreWorkspaceAccess,
    setInviteAdmissionForRoom,
    setInviteMessageForRoom
  } = store;
  const setSelectedInviteMessage = (message: string | null) =>
    setInviteMessageForRoom(options.selectedRoomIdRef.current, message);

  function importInviteMetadata({ teamId, roomId, roomName }: { teamId: string; roomId: string; roomName: string }) {
    upsertTeam({ id: teamId, name: "Invited team", members: 1 });
    upsertRoom(buildFallbackInvitedRoom({ teamId, roomId, roomName }));
  }

  async function requestNoSecretInviteAccess(encodedInvite: string, inviteId?: string | null) {
    const { deviceIdentity } = useAppStore.getState();
    const { localUser, deviceId } = currentLocalIdentity();
    const inviteSecret = decodeNoSecretRoomInvite(encodedInvite);
    if ((await fingerprintPublicKey(inviteSecret.hostPublicKeyJwk)) !== inviteSecret.hostPublicKeyFingerprint) {
      throw new Error("Invite host public key fingerprint does not match the embedded key.");
    }
    let acceptedRoomName = inviteSecret.roomName;
    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match the no-secret invite fragment.");
      }
      if (metadata.room.hostUserId && metadata.room.hostUserId !== inviteSecret.hostUserId) {
        throw new Error("Invite host identity does not match the room's active host.");
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
    const request = await buildPendingInviteJoinRequest({
      deviceId,
      deviceIdentity,
      inviteId,
      localUser,
      roomName: acceptedRoomName,
      capabilityInvite: inviteSecret
    });
    rememberPendingInviteCapability({
      ...inviteSecret,
      inviteId: request.inviteId!,
      requestId: request.id,
      requestNonce: request.requestNonce,
      requesterUserId: request.requesterUserId,
      requesterDeviceId: request.requesterDeviceId,
      requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint
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

  async function joinInviteSecret() {
    const { inviteSecretInput } = useAppStore.getState();
    const raw = inviteSecretInput.trim();
    if (!raw) return;
    setSelectedInviteMessage(null);
    clearInviteSecretInput();
    try {
      const { inviteId, joinInvite } = parseInviteInput(raw);
      await requestNoSecretInviteAccess(joinInvite, inviteId);
    } catch (error) {
      setSelectedInviteMessage(`Invite could not be imported: ${String(error)}`);
    }
  }

  return { joinInviteSecret, requestNoSecretInviteAccess };
}

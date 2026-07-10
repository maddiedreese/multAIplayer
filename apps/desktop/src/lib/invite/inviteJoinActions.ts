import type { InviteJoinRequestPlaintextPayload } from "@multaiplayer/protocol";
import { decodeRoomInviteSecret } from "@multaiplayer/crypto";
import { importRoomSecret } from "../localHistory";
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
  | "restoreForgottenRoom"
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
    restoreForgottenRoom,
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
    const { deviceIdentity } = useAppStore.getState();
    const { localUser, deviceId } = currentLocalIdentity();
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
    const { inviteSecretInput } = useAppStore.getState();
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

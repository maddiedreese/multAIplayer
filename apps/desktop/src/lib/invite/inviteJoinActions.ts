import { decodeNoSecretRoomInvite } from "../noSecretRoomInvite";
import { ensureRoomDefaults } from "../roomDefaults";
import { buildFallbackInvitedRoom, parseInviteInput } from "../inviteActionsHelpers";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity } from "../selectedWorkspace";
import {
  acknowledgeDirectedInviteResponse,
  loadDirectedInviteResponse,
  loadTeamDevices,
  lookupInvite,
  publishDirectedInviteRequest,
  publishKeyPackages
} from "../workspaceClient";
import {
  generateMlsKeyPackage,
  acceptMlsInviteResponse,
  sealMlsInviteRequest,
  type MlsInviteCapabilityBinding
} from "../mlsClient";
import { randomInviteNonce } from "./mlsInviteProtocol";
import type { InviteJoinRequest } from "../../types";
import { completeMlsRelayAdmission } from "../mlsJoinAdmission";

type InviteJoinActionOptions = Pick<
  UseInviteActionsOptions,
  "clearInviteSecretInput" | "relayRef" | "selectedRoomIdRef" | "selectWorkspaceRoom" | "upsertRoom" | "upsertTeam"
>;

type InviteJoinStore = Pick<
  AppStoreState,
  | "appendInviteRequest"
  | "initializeMessagesForRoom"
  | "restoreWorkspaceAccess"
  | "restoreForgottenRoom"
  | "setInviteAdmissionForRoom"
  | "setInviteMessageForRoom"
  | "updateInviteRequestStatus"
>;

export function createInviteJoinActions(
  options: InviteJoinActionOptions,
  store: InviteJoinStore = useAppStore.getState()
) {
  const { clearInviteSecretInput, selectWorkspaceRoom, upsertRoom, upsertTeam } = options;
  const setSelectedInviteMessage = (message: string | null) =>
    store.setInviteMessageForRoom(options.selectedRoomIdRef.current, message);

  async function requestNoSecretInviteAccess(encodedInvite: string, inviteId?: string | null) {
    const invite = decodeNoSecretRoomInvite(encodedInvite);
    if (!inviteId) throw new Error("The relay invite id is missing.");
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new Error("This invite has expired.");
    const { localUser, deviceId } = currentLocalIdentity();
    const metadata = await lookupInvite(inviteId);
    if (metadata.invite.teamId !== invite.teamId || metadata.invite.roomId !== invite.roomId)
      throw new Error("Invite metadata does not match the protected URL fragment.");
    if (metadata.room.hostUserId !== invite.hostUserId || metadata.room.activeHostDeviceId !== invite.hostDeviceId)
      throw new Error("The invite is not issued by the active host device.");
    const hostDevice = (await loadTeamDevices(invite.teamId)).find(
      (device) => device.userId === invite.hostUserId && device.deviceId === invite.hostDeviceId
    );
    if (
      !hostDevice ||
      hostDevice.hpkePublicKey !== invite.hostHpkePublicKey ||
      hostDevice.hpkeKeyFingerprint !== invite.hostHpkeKeyFingerprint
    )
      throw new Error("The invite host HPKE key does not match the registered device.");

    upsertTeam(metadata.team);
    upsertRoom(ensureRoomDefaults(metadata.room));
    store.restoreWorkspaceAccess(invite.teamId, invite.roomId);
    store.setInviteAdmissionForRoom(invite.roomId, inviteId);
    store.initializeMessagesForRoom(invite.roomId);
    selectWorkspaceRoom(invite.teamId, invite.roomId);
    clearInviteSecretInput();

    const keyPackage = await generateMlsKeyPackage();
    await publishKeyPackages(deviceId, [keyPackage]);
    const requestId = crypto.randomUUID();
    const binding: MlsInviteCapabilityBinding = {
      version: 3,
      phase: "request",
      inviteId: inviteId,
      teamId: invite.teamId,
      roomId: invite.roomId,
      keyEpoch: metadata.room.acceptedMlsEpoch ?? 0,
      keyPackageHash: keyPackage.keyPackageHash,
      requestId: requestId,
      requestNonce: randomInviteNonce(),
      requesterUserId: localUser.id,
      requesterDeviceId: deviceId,
      hostUserId: invite.hostUserId,
      hostDeviceId: invite.hostDeviceId,
      expiresAt: invite.expiresAt,
      status: null,
      decidedAt: null
    };
    const protectedRequest = await sealMlsInviteRequest(
      invite.hostHpkePublicKey,
      invite.capabilityHandle,
      invite.capabilityUrlValue,
      binding,
      keyPackage.keyPackage
    );
    if (protectedRequest.keyPackageHash !== keyPackage.keyPackageHash)
      throw new Error("Native invite protection returned an unexpected KeyPackage hash.");
    await publishDirectedInviteRequest(inviteId, {
      requestId,
      requesterDeviceId: deviceId,
      keyPackageId: keyPackage.id,
      keyPackageHash: keyPackage.keyPackageHash,
      sealedRequest: JSON.stringify({ version: 3, binding, sealedPayload: protectedRequest.sealedPayload })
    });
    const localRequest: InviteJoinRequest = {
      id: requestId,
      inviteId,
      requester: localUser.name,
      requesterUserId: localUser.id,
      requesterDeviceId: deviceId,
      keyPackageId: keyPackage.id,
      keyPackageHash: keyPackage.keyPackageHash,
      requestedAt: new Date().toISOString(),
      note: `Requesting access to ${metadata.room.name}.`,
      status: "pending"
    };
    store.appendInviteRequest(invite.roomId, localRequest);
    store.setInviteMessageForRoom(
      invite.roomId,
      `Requested access to ${metadata.room.name}. The active host must approve this KeyPackage.`
    );
    void waitForResponse(
      inviteId,
      requestId,
      deviceId,
      invite.roomId,
      metadata.room.name,
      invite.capabilityUrlValue,
      binding
    );
  }

  async function waitForResponse(
    inviteId: string,
    requestId: string,
    deviceId: string,
    roomId: string,
    roomName: string,
    capabilityUrlValue: string,
    originalBinding: MlsInviteCapabilityBinding
  ) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      try {
        const response = await loadDirectedInviteResponse(inviteId, requestId, deviceId);
        if (!response) continue;
        const accepted = await acceptMlsInviteResponse(
          capabilityUrlValue,
          originalBinding,
          response.responseBinding as MlsInviteCapabilityBinding,
          response.responseMac,
          response.welcome
        );
        if (accepted.status === "denied") {
          await acknowledgeDirectedInviteResponse(inviteId, requestId, deviceId);
          store.updateInviteRequestStatus(roomId, requestId, "denied");
          store.setInviteMessageForRoom(roomId, `The host denied access to ${roomName}.`);
          return;
        }
        const relay = options.relayRef.current;
        const state = useAppStore.getState();
        const room = state.rooms.find((candidate) => candidate.id === roomId);
        const { localUser } = currentLocalIdentity();
        if (!relay || !room || !state.deviceSessionToken)
          throw new Error("Relay admission cannot be confirmed yet; the response remains available for retry.");
        await completeMlsRelayAdmission(
          relay,
          {
            inviteId,
            teamId: room.teamId,
            roomId,
            requestId,
            requesterUserId: localUser.id,
            requesterDeviceId: deviceId
          },
          state.deviceSessionToken,
          () => {
            store.restoreWorkspaceAccess(room.teamId, roomId);
            store.restoreForgottenRoom(roomId);
            store.updateInviteRequestStatus(roomId, requestId, "approved");
            store.setInviteMessageForRoom(roomId, `The host approved this device. ${roomName} is now unlocked.`);
          }
        );
        return;
      } catch (error) {
        store.setInviteMessageForRoom(roomId, `Could not join the MLS group: ${String(error)}`);
        return;
      }
    }
    store.setInviteMessageForRoom(roomId, "The invite request is still pending. Import the link again to retry.");
  }

  async function joinInviteSecret() {
    const raw = useAppStore.getState().inviteSecretInput.trim();
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

export { buildFallbackInvitedRoom };

import { decodeNoSecretRoomInvite } from "../noSecretRoomInvite";
import { ensureRoomDefaults } from "../roomDefaults";
import { buildFallbackInvitedRoom, parseInviteInput } from "../inviteActionsHelpers";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity } from "../selectedWorkspace";
import {
  acknowledgeDirectedInviteResponse,
  loadDirectedInviteResponse,
  lookupInvite,
  publishDirectedInviteRequest,
  publishKeyPackages,
  type InviteLookupResult
} from "../workspaceClient";
import {
  generateMlsKeyPackage,
  acceptPendingMlsInviteResponse,
  completePendingMlsInviteRequest,
  listMlsJoinAdmissions,
  listPendingMlsInviteRequests,
  sealMlsInviteRequest,
  type MlsInviteCapabilityBinding,
  type MlsJoinAdmission,
  type PendingMlsInviteRequest
} from "../mlsClient";
import { randomInviteNonce } from "./mlsInviteProtocol";
import type { InviteJoinRequest, NoSecretRoomInvite } from "../../types";
import {
  completeMlsRelayAdmission,
  pendingInviteMatchesAdmission,
  synchronizeMlsRecoverySelection
} from "../mlsJoinAdmission";
import {
  clearPendingInviteIfMissing,
  publishPendingInviteRequest,
  runPendingInviteRecoveryLoop
} from "./pendingInviteRecovery";
import {
  PendingInviteWaitRegistry,
  runOwnedPendingInviteRecovery,
  type PendingInviteWaitObserver,
  type PendingInviteWaitOwnership
} from "./pendingInviteWaitRegistry";

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

const pendingInviteWaits = new PendingInviteWaitRegistry();

export function assertPendingInviteRecoveryContext(
  pending: PendingMlsInviteRequest,
  identity: { userId: string; deviceId: string },
  metadata: Awaited<ReturnType<typeof lookupInvite>>
): void {
  if (
    pending.requesterUserId !== identity.userId ||
    pending.requesterDeviceId !== identity.deviceId ||
    metadata.invite.id !== pending.inviteId ||
    metadata.invite.teamId !== pending.teamId ||
    metadata.invite.roomId !== pending.roomId ||
    metadata.room.id !== pending.roomId ||
    metadata.room.teamId !== pending.teamId
  ) {
    throw new Error("Pending invite recovery does not match this device or relay invite metadata.");
  }
}

export function assertInviteHostDevice(
  invite: Pick<NoSecretRoomInvite, "hostUserId" | "hostDeviceId" | "hostHpkePublicKey" | "hostHpkeKeyFingerprint">,
  metadata: Pick<InviteLookupResult, "hostDevice">
): void {
  const hostDevice = metadata.hostDevice;
  if (
    !hostDevice ||
    hostDevice.userId !== invite.hostUserId ||
    hostDevice.deviceId !== invite.hostDeviceId ||
    hostDevice.hpkePublicKey !== invite.hostHpkePublicKey ||
    hostDevice.hpkeKeyFingerprint !== invite.hostHpkeKeyFingerprint
  ) {
    throw new Error("The invite host HPKE key does not match the registered device.");
  }
}

export function pendingInviteHasMatchingAdmission(
  pending: PendingMlsInviteRequest,
  admissions: readonly MlsJoinAdmission[]
): boolean {
  return admissions.some((admission) => pendingInviteMatchesAdmission(pending, admission));
}

export async function loadObservedResumablePendingInvites(
  registry: PendingInviteWaitRegistry,
  loadAdmissions: () => Promise<MlsJoinAdmission[]>,
  loadPending: () => Promise<PendingMlsInviteRequest[]>
): Promise<Array<{ pending: PendingMlsInviteRequest; observer: PendingInviteWaitObserver }>> {
  const scan = registry.beginScan();
  try {
    const admissions = await loadAdmissions();
    const pending = (await loadPending()).filter((request) => !pendingInviteHasMatchingAdmission(request, admissions));
    const observers = scan.observe(pending.map((request) => request.requestId));
    return pending.map((request) => ({ pending: request, observer: observers.get(request.requestId)! }));
  } finally {
    scan.release();
  }
}

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
    assertInviteHostDevice(invite, metadata);

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
      keyPackage.keyPackage,
      keyPackage.id
    );
    if (protectedRequest.keyPackageHash !== keyPackage.keyPackageHash)
      throw new Error("Native invite protection returned an unexpected KeyPackage hash.");
    const pendingRequest: PendingMlsInviteRequest = {
      inviteId,
      teamId: invite.teamId,
      roomId: invite.roomId,
      requestId,
      requesterUserId: localUser.id,
      requesterDeviceId: deviceId,
      keyPackageId: keyPackage.id,
      keyPackageHash: keyPackage.keyPackageHash,
      expiresAt: invite.expiresAt,
      sealedRequest: protectedRequest.sealedRequest
    };
    try {
      await publishPendingInviteRequest(pendingRequest, publishDirectedInviteRequest);
    } catch (error) {
      // The native record already committed. Keep transient publication recovery alive even
      // though the import action reports the immediate relay failure to the user.
      void waitForResponse(pendingRequest, metadata.room.name);
      throw error;
    }
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
    void waitForResponse(pendingRequest, metadata.room.name);
  }

  async function waitForResponse(
    pending: PendingMlsInviteRequest,
    roomName: string,
    transferredOwnership?: PendingInviteWaitOwnership
  ) {
    const ownership = transferredOwnership ?? pendingInviteWaits.claim(pending.requestId);
    if (!ownership) return;
    const { requestId, roomId } = pending;
    try {
      const result = await runPendingInviteRecoveryLoop(pending, {
        loadResponse: loadDirectedInviteResponse,
        publishRequest: publishDirectedInviteRequest,
        acceptResponse: acceptPendingMlsInviteResponse,
        acknowledge: acknowledgeDirectedInviteResponse,
        clear: completePendingMlsInviteRequest,
        completeAdmission: async (recovery) => {
          const relay = options.relayRef.current;
          const state = useAppStore.getState();
          const room = state.rooms.find((candidate) => candidate.id === recovery.roomId);
          if (!relay || !room || !state.deviceSessionToken) throw new Error("Relay admission is not connected yet.");
          await completeMlsRelayAdmission(
            relay,
            {
              inviteId: recovery.inviteId,
              teamId: recovery.teamId,
              roomId: recovery.roomId,
              requestId: recovery.requestId,
              requesterUserId: recovery.requesterUserId,
              requesterDeviceId: recovery.requesterDeviceId
            },
            state.deviceSessionToken,
            () => {
              store.restoreWorkspaceAccess(room.teamId, room.id);
              store.restoreForgottenRoom(room.id);
            }
          );
        }
      });
      if (result === "expired") {
        ownership.settle();
        store.updateInviteRequestStatus(roomId, requestId, "denied");
        store.setInviteMessageForRoom(roomId, "The pending invite expired before the host responded.");
        return;
      }
      if (result === "denied") {
        ownership.settle();
        store.updateInviteRequestStatus(roomId, requestId, "denied");
        store.setInviteMessageForRoom(roomId, `The host denied access to ${roomName}.`);
        return;
      }
      if (result === "admission-pending") {
        ownership.settle();
        store.setInviteMessageForRoom(
          roomId,
          "The host approved this device. Relay admission is pending and will resume after reconnecting."
        );
        return;
      }
      if (result === "approved") {
        ownership.settle();
        store.updateInviteRequestStatus(roomId, requestId, "approved");
        store.setInviteMessageForRoom(roomId, `The host approved this device. ${roomName} is now unlocked.`);
        return;
      }
      store.setInviteMessageForRoom(roomId, "The invite request is still pending and will retry after reconnecting.");
    } catch (error) {
      const cleared = await clearPendingInviteIfMissing(error, pending, completePendingMlsInviteRequest);
      if (cleared) ownership.settle();
      store.setInviteMessageForRoom(
        roomId,
        cleared
          ? "The pending invite is no longer available on the relay."
          : `Could not join the MLS group: ${String(error)}`
      );
    } finally {
      ownership.release();
    }
  }

  async function resumePendingInviteRequests(): Promise<void> {
    const { localUser, deviceId } = currentLocalIdentity();
    // Snapshot admissions first. Native completion removes the pending request
    // before its superseding admission, so this ordering cannot rediscover a
    // consumed relay invite after admission recovery has already won the race.
    const pendingRequests = await loadObservedResumablePendingInvites(
      pendingInviteWaits,
      listMlsJoinAdmissions,
      listPendingMlsInviteRequests
    );
    try {
      for (const { pending, observer } of pendingRequests) {
        await runOwnedPendingInviteRecovery({
          observer,
          load: async () => {
            const metadata = await lookupInvite(pending.inviteId);
            assertPendingInviteRecoveryContext(pending, { userId: localUser.id, deviceId }, metadata);
            return metadata;
          },
          recover: (metadata, ownership) => {
            upsertTeam(metadata.team);
            upsertRoom(ensureRoomDefaults(metadata.room));
            store.restoreWorkspaceAccess(pending.teamId, pending.roomId);
            store.setInviteAdmissionForRoom(pending.roomId, pending.inviteId);
            store.initializeMessagesForRoom(pending.roomId);
            synchronizeMlsRecoverySelection(pending, useAppStore.getState());
            const existing = useAppStore
              .getState()
              .inviteByRoom?.[pending.roomId]?.requests?.some((request) => request.id === pending.requestId);
            if (!existing) {
              store.appendInviteRequest(pending.roomId, {
                id: pending.requestId,
                inviteId: pending.inviteId,
                requester: localUser.name,
                requesterUserId: pending.requesterUserId,
                requesterDeviceId: pending.requesterDeviceId,
                keyPackageId: pending.keyPackageId,
                keyPackageHash: pending.keyPackageHash,
                requestedAt: new Date().toISOString(),
                note: `Recovering access to ${metadata.room.name}.`,
                status: "pending"
              });
            }
            void waitForResponse(pending, metadata.room.name, ownership);
            return "transfer";
          },
          onError: async (error, ownership) => {
            const cleared = await clearPendingInviteIfMissing(error, pending, completePendingMlsInviteRequest);
            if (cleared) ownership.settle();
            store.setInviteMessageForRoom(
              pending.roomId,
              cleared
                ? "The pending invite is no longer available on the relay."
                : `Could not recover the pending invite: ${String(error)}`
            );
          }
        });
      }
    } finally {
      for (const { observer } of pendingRequests) observer.release();
    }
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

  return { joinInviteSecret, requestNoSecretInviteAccess, resumePendingInviteRequests };
}

export { buildFallbackInvitedRoom };

import type { MlsRelayMessage } from "@multaiplayer/protocol";
import { canActOnRoomInviteRequest, findRoomInviteRequest, roomInviteRequestMessage } from "../inviteApproval";
import { roomLockMessage } from "../appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { InviteJoinRequest } from "../../types";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoomContext } from "../selectedWorkspace";
import {
  consumeKeyPackage,
  loadDirectedInviteRequests,
  loadTeamDevices,
  lookupInvite,
  publishDirectedInviteResponse,
  type DirectedInviteRequest
} from "../workspaceClient";
import {
  approveMlsInvite,
  currentMlsEpoch,
  denyMlsInvite,
  listMlsOutbox,
  markMlsPublishSucceeded,
  openMlsInviteRequest
} from "../mlsClient";
import { isStaleMlsPublish } from "../relayClient";
import { clearAndRebaseStaleMlsCommit } from "../mlsCommitRebase";
import { parseDirectedMlsInviteCiphertext } from "./mlsInviteProtocol";
import { reportExpectedFailure } from "../nonFatalReporting";

type InviteRelayActionOptions = Pick<UseInviteActionsOptions, "relayRef" | "seenEnvelopeIds" | "selectedRoomIdRef">;
const inviteDecisionsInFlight = new Set<string>();
const validatedRequests = new Map<
  string,
  {
    record: DirectedInviteRequest;
    protected: Awaited<ReturnType<typeof openMlsInviteRequest>>;
  }
>();
const approvedInviteOutboxes = new Map<string, Awaited<ReturnType<typeof approveMlsInvite>>>();

type InviteRelayStore = Pick<
  AppStoreState,
  "appendInviteRequest" | "setInviteMessageForRoom" | "updateInviteRequestStatus"
>;

export function createInviteRelayActions(
  options: InviteRelayActionOptions,
  store: InviteRelayStore = useAppStore.getState()
) {
  const { relayRef, seenEnvelopeIds, selectedRoomIdRef } = options;

  async function handleInviteRequested(inviteId: string): Promise<void> {
    const { localUser, deviceId } = currentLocalIdentity();
    const metadata = await lookupInvite(inviteId);
    if (metadata.room.hostUserId !== localUser.id || metadata.room.activeHostDeviceId !== deviceId) return;
    const records = await loadDirectedInviteRequests(inviteId, deviceId);
    for (const record of records) {
      if (validatedRequests.has(record.requestId)) continue;
      try {
        const ciphertext = parseDirectedMlsInviteCiphertext(record.sealedRequest);
        const binding = ciphertext.binding;
        if (
          binding.inviteId !== inviteId ||
          binding.teamId !== metadata.room.teamId ||
          binding.roomId !== metadata.room.id ||
          binding.keyEpoch !== (metadata.room.acceptedMlsEpoch ?? 0) ||
          binding.keyPackageHash !== record.keyPackageHash ||
          binding.requestId !== record.requestId ||
          binding.requesterUserId !== record.requesterUserId ||
          binding.requesterDeviceId !== record.requesterDeviceId ||
          binding.hostUserId !== localUser.id ||
          binding.hostDeviceId !== deviceId ||
          Date.parse(binding.expiresAt) <= Date.now()
        )
          continue;
        const value = await openMlsInviteRequest(binding, ciphertext.sealedPayload);
        if (value.binding.keyPackageHash !== record.keyPackageHash) continue;
        const requesterDevice = (await loadTeamDevices(metadata.room.teamId)).find(
          (device) => device.userId === record.requesterUserId && device.deviceId === record.requesterDeviceId
        );
        if (
          !requesterDevice ||
          requesterDevice.signaturePublicKey !== value.requesterSignaturePublicKey ||
          requesterDevice.signatureKeyFingerprint !== value.requesterSignatureKeyFingerprint
        )
          continue;
        validatedRequests.set(record.requestId, { record, protected: value });
        store.appendInviteRequest(metadata.room.id, {
          id: record.requestId,
          inviteId,
          requester: record.requesterUserId,
          requesterUserId: record.requesterUserId,
          requesterDeviceId: record.requesterDeviceId,
          keyPackageId: record.keyPackageId,
          keyPackageHash: record.keyPackageHash,
          requesterSignatureKeyFingerprint: value.requesterSignatureKeyFingerprint,
          requestedAt: record.createdAt,
          note: "Capability-authenticated MLS KeyPackage request.",
          status: "pending"
        });
      } catch {
        // Invalid HPKE payloads and capability bindings are intentionally ignored.
        reportExpectedFailure("invite HPKE payload or capability binding validation failed");
      }
    }
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    const context = currentSelectedRoomContext();
    if (!context) return;
    const { room, isActiveHost, hostGateMessage, deviceId } = context;
    const appStore = useAppStore.getState();
    const revoked = appStore.revokedRoomIds.has(room.id) || appStore.revokedTeamIds.has(room.teamId);
    if (room.archivedAt || appStore.forgottenRoomIds.has(room.id) || revoked) {
      store.setInviteMessageForRoom(room.id, roomLockMessage(room, revoked));
      return;
    }
    if (!isActiveHost) {
      store.setInviteMessageForRoom(room.id, hostGateMessage);
      return;
    }
    if (status === "pending") return;
    const requests = appStore.inviteByRoom[room.id]?.requests ?? [];
    const roomRequest = findRoomInviteRequest(requests, request.id);
    if (!roomRequest || !canActOnRoomInviteRequest(requests, request.id)) {
      store.setInviteMessageForRoom(room.id, roomInviteRequestMessage(requests, request.id));
      return;
    }
    if (inviteDecisionsInFlight.has(request.id)) return;
    inviteDecisionsInFlight.add(request.id);
    try {
      let validated = validatedRequests.get(request.id);
      if (!validated) {
        await handleInviteRequested(request.inviteId);
        validated = validatedRequests.get(request.id);
      }
      if (!validated) throw new Error("Invite request is no longer capability-authenticated.");
      if (status === "denied") {
        const denial = await denyMlsInvite(
          validated.protected.capabilityHandle,
          validated.protected.binding,
          validated.protected.mac
        );
        await publishDirectedInviteResponse(request.inviteId, {
          hostDeviceId: deviceId,
          requestId: request.id,
          status: "denied",
          responseBinding: denial.responseBinding as never,
          responseMac: denial.responseMac
        });
        await markMlsPublishSucceeded(room.id, denial.outboxId);
        validatedRequests.delete(request.id);
        store.updateInviteRequestStatus(room.id, request.id, "denied");
        store.setInviteMessageForRoom(room.id, `Denied ${request.requester}'s join request.`);
        return;
      }
      const epoch = await currentMlsEpoch(room.id);
      if (epoch !== validated.protected.binding.keyEpoch)
        throw new Error("Invite expired after the MLS epoch changed.");
      let approval = approvedInviteOutboxes.get(request.id);
      if (!approval) {
        const priorOutbox = await listMlsOutbox();
        const retriedWelcome = priorOutbox.find(
          (item) =>
            item.kind === "welcome" && item.metadata?.type === "welcome" && item.metadata.requestId === request.id
        );
        if (retriedWelcome && retriedWelcome.metadata?.type === "welcome") {
          const retriedCommit = priorOutbox.find(
            (item) => item.roomId === room.id && item.epoch === retriedWelcome.epoch && item.metadata?.type === "commit"
          );
          approval = {
            epoch: retriedWelcome.epoch,
            commitOutboxId: retriedCommit?.id ?? "",
            welcomeOutboxId: retriedWelcome.id,
            responseBinding: retriedWelcome.metadata.responseBinding as never,
            responseMac: String(retriedWelcome.metadata.responseMac),
            requesterSignaturePublicKey: validated.protected.requesterSignaturePublicKey,
            requesterSignatureKeyFingerprint: validated.protected.requesterSignatureKeyFingerprint
          };
          approvedInviteOutboxes.set(request.id, approval);
        }
      }
      if (!approval) {
        const consumed = await consumeKeyPackage(
          room.id,
          request.requesterUserId,
          request.requesterDeviceId,
          deviceId,
          request.inviteId,
          request.keyPackageId,
          request.keyPackageHash
        );
        if ("keyPackage" in consumed) {
          const keyPackage = consumed.keyPackage;
          if (
            keyPackage.id !== request.keyPackageId ||
            keyPackage.keyPackageHash !== request.keyPackageHash ||
            keyPackage.keyPackage !== validated.protected.keyPackage
          )
            throw new Error("Relay returned a KeyPackage different from the protected request.");
        } else if (
          consumed.keyPackageId !== request.keyPackageId ||
          consumed.keyPackageHash !== request.keyPackageHash ||
          consumed.userId !== request.requesterUserId ||
          consumed.deviceId !== request.requesterDeviceId
        ) {
          throw new Error("Relay returned a KeyPackage receipt different from the protected request.");
        }
        approval = await approveMlsInvite(
          validated.protected.capabilityHandle,
          validated.protected.binding,
          validated.protected.mac,
          validated.protected.keyPackage,
          request.keyPackageId
        );
        approvedInviteOutboxes.set(request.id, approval);
      }
      const outbox = await listMlsOutbox();
      const commit = outbox.find((item) => item.id === approval!.commitOutboxId);
      const welcome = outbox.find((item) => item.id === approval!.welcomeOutboxId);
      if (!welcome) throw new Error("Native MLS Welcome outbox is incomplete.");
      if (commit) {
        const message: MlsRelayMessage = {
          id: commit.id,
          teamId: room.teamId,
          roomId: room.id,
          senderUserId: context.localUser.id,
          senderDeviceId: deviceId,
          createdAt: new Date().toISOString(),
          messageType: "commit",
          epochHint: commit.metadata?.type === "commit" ? commit.metadata.parentEpoch : epoch,
          mlsMessage: commit.payload
        };
        const relay = relayRef.current;
        if (!relay) throw new Error("Relay is unavailable.");
        seenEnvelopeIds.current.add(message.id);
        try {
          await relay.publishAndWaitForAck({ type: "publish", message });
        } catch (error) {
          seenEnvelopeIds.current.delete(message.id);
          if (isStaleMlsPublish(error)) {
            approvedInviteOutboxes.delete(request.id);
            const token = useAppStore.getState().deviceSessionToken;
            if (!token) throw new Error("Device session expired before MLS stale-epoch rebase.");
            await clearAndRebaseStaleMlsCommit(
              relay,
              room,
              { userId: context.localUser.id, deviceId, deviceSessionToken: token },
              commit.id,
              commit.metadata?.type === "commit" ? commit.metadata.parentEpoch : epoch
            );
          }
          throw error;
        }
        await markMlsPublishSucceeded(room.id, commit.id);
      } else if ((await currentMlsEpoch(room.id)) < approval.epoch) {
        throw new Error("Native MLS invite commit is missing before its Welcome was delivered.");
      }
      await publishDirectedInviteResponse(request.inviteId, {
        hostDeviceId: deviceId,
        requestId: request.id,
        status: "approved",
        responseBinding: approval.responseBinding as never,
        responseMac: approval.responseMac,
        welcome: welcome.payload
      });
      await markMlsPublishSucceeded(room.id, welcome.id);
      approvedInviteOutboxes.delete(request.id);
      validatedRequests.delete(request.id);
      store.updateInviteRequestStatus(room.id, request.id, "approved");
      store.setInviteMessageForRoom(room.id, `Approved ${request.requester}'s MLS KeyPackage.`);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) store.setInviteMessageForRoom(room.id, String(error));
    } finally {
      inviteDecisionsInFlight.delete(request.id);
    }
  }

  return { decideInviteJoinRequest, handleInviteRequested };
}

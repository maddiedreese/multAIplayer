import {
  completeMlsJoinAdmission,
  completePendingMlsInviteRequest,
  type MlsJoinAdmission,
  type PendingMlsInviteRequest
} from "./mlsClient";
import type { RelayClient } from "./relayClient";
import { acknowledgeDirectedInviteResponse } from "./workspaceClient";
import type { InviteJoinRequest } from "../types";
import { reportExpectedFailure } from "./nonFatalReporting";

interface AdmissionDependencies {
  acknowledge: typeof acknowledgeDirectedInviteResponse;
  complete: typeof completeMlsJoinAdmission;
}

interface AdmissionSelectionStore {
  selectedTeam: string;
  selectedRoomId: string;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
}

const defaultDependencies: AdmissionDependencies = {
  acknowledge: acknowledgeDirectedInviteResponse,
  complete: async (roomId, requestId) => {
    await completePendingMlsInviteRequest(requestId, roomId);
    await completeMlsJoinAdmission(roomId, requestId);
  }
};

const pendingAdmissionCompletions = new Map<string, Promise<void>>();

export function pendingInviteMatchesAdmission(pending: PendingMlsInviteRequest, admission: MlsJoinAdmission): boolean {
  return (
    pending.requestId === admission.requestId &&
    pending.inviteId === admission.inviteId &&
    pending.teamId === admission.teamId &&
    pending.roomId === admission.roomId &&
    pending.requesterUserId === admission.requesterUserId &&
    pending.requesterDeviceId === admission.requesterDeviceId
  );
}

function localInviteRequestMatchesPending(request: InviteJoinRequest, pending: PendingMlsInviteRequest): boolean {
  return (
    request.id === pending.requestId &&
    request.inviteId === pending.inviteId &&
    request.requesterUserId === pending.requesterUserId &&
    request.requesterDeviceId === pending.requesterDeviceId &&
    request.keyPackageId === pending.keyPackageId &&
    request.keyPackageHash === pending.keyPackageHash
  );
}

function localInviteRequestMatchesAdmission(request: InviteJoinRequest, admission: MlsJoinAdmission): boolean {
  return (
    request.id === admission.requestId &&
    request.inviteId === admission.inviteId &&
    request.requesterUserId === admission.requesterUserId &&
    request.requesterDeviceId === admission.requesterDeviceId
  );
}

export function projectMlsAdmissionInviteRequest(options: {
  admission: MlsJoinAdmission;
  pendingRequests: readonly PendingMlsInviteRequest[];
  existingRequests: readonly InviteJoinRequest[];
  requesterName: string;
  roomName: string;
  requestedAt?: string;
  append: (roomId: string, request: InviteJoinRequest) => void;
  approve: (roomId: string, requestId: string) => void;
}): "reconstructed" | "existing" | "unavailable" {
  const pending = options.pendingRequests.find((candidate) => candidate.requestId === options.admission.requestId);
  if (pending && !pendingInviteMatchesAdmission(pending, options.admission)) {
    return "unavailable";
  }
  const existing = options.existingRequests.find((request) => request.id === options.admission.requestId);
  if (existing && !localInviteRequestMatchesAdmission(existing, options.admission)) {
    return "unavailable";
  }
  if (existing && pending && !localInviteRequestMatchesPending(existing, pending)) {
    return "unavailable";
  }
  if (existing) {
    options.approve(options.admission.roomId, options.admission.requestId);
    return "existing";
  }
  if (!pending) return "unavailable";
  options.append(pending.roomId, {
    id: pending.requestId,
    inviteId: pending.inviteId,
    requester: options.requesterName,
    requesterUserId: pending.requesterUserId,
    requesterDeviceId: pending.requesterDeviceId,
    keyPackageId: pending.keyPackageId,
    keyPackageHash: pending.keyPackageHash,
    requestedAt: options.requestedAt ?? new Date().toISOString(),
    note: `Recovering approved access to ${options.roomName}.`,
    status: "pending"
  });
  options.approve(pending.roomId, pending.requestId);
  return "reconstructed";
}

export async function coordinateMlsAdmissionRecovery(options: {
  admissions: readonly MlsJoinAdmission[];
  requesterUserId: string;
  requesterDeviceId: string;
  loadPendingRequests: () => Promise<PendingMlsInviteRequest[]>;
  complete: (admission: MlsJoinAdmission, pendingRequests: readonly PendingMlsInviteRequest[]) => Promise<void>;
}): Promise<number> {
  const relevantAdmissions = options.admissions.filter(
    (admission) =>
      admission.requesterUserId === options.requesterUserId && admission.requesterDeviceId === options.requesterDeviceId
  );
  if (relevantAdmissions.length === 0) return 0;

  let pendingRequests: PendingMlsInviteRequest[] = [];
  try {
    pendingRequests = await options.loadPendingRequests();
  } catch (_error) {
    reportExpectedFailure("durable MLS admission projection snapshot unavailable");
  }
  for (const admission of relevantAdmissions) await options.complete(admission, pendingRequests);
  return relevantAdmissions.length;
}

function admissionCompletionKey(admission: MlsJoinAdmission): string {
  return `${admission.roomId}\0${admission.requestId}`;
}

export function synchronizeMlsRecoverySelection(
  admission: Pick<MlsJoinAdmission, "teamId" | "roomId">,
  store: AdmissionSelectionStore
): void {
  if (store.selectedRoomId === admission.roomId && store.selectedTeam !== admission.teamId) {
    store.selectWorkspaceRoom(admission.teamId, admission.roomId);
  }
}

export function completeMlsRelayAdmission(
  client: RelayClient,
  admission: MlsJoinAdmission,
  deviceSessionToken: string,
  beforeComplete: () => void | Promise<void> = () => undefined,
  dependencies: AdmissionDependencies = defaultDependencies
): Promise<void> {
  const key = admissionCompletionKey(admission);
  const pending = pendingAdmissionCompletions.get(key);
  if (pending) return pending;

  const completion = (async () => {
    await dependencies.acknowledge(admission.inviteId, admission.requestId, admission.requesterDeviceId);
    await client.joinAndWaitForAck({
      type: "join",
      teamId: admission.teamId,
      roomId: admission.roomId,
      userId: admission.requesterUserId,
      deviceId: admission.requesterDeviceId,
      deviceSessionToken
    });
    await beforeComplete();
    await dependencies.complete(admission.roomId, admission.requestId);
  })();
  pendingAdmissionCompletions.set(key, completion);
  const clearCompletion = () => {
    if (pendingAdmissionCompletions.get(key) === completion) pendingAdmissionCompletions.delete(key);
  };
  void completion.then(clearCompletion, clearCompletion);
  return completion;
}

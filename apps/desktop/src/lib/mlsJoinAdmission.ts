import { completeMlsJoinAdmission, completePendingMlsInviteRequest, type MlsJoinAdmission } from "./mlsClient";
import type { RelayClient } from "./relayClient";
import { acknowledgeDirectedInviteResponse } from "./workspaceClient";

interface AdmissionDependencies {
  acknowledge: typeof acknowledgeDirectedInviteResponse;
  complete: typeof completeMlsJoinAdmission;
}

const defaultDependencies: AdmissionDependencies = {
  acknowledge: acknowledgeDirectedInviteResponse,
  complete: async (roomId, requestId) => {
    await completePendingMlsInviteRequest(requestId, roomId);
    await completeMlsJoinAdmission(roomId, requestId);
  }
};

const pendingAdmissionCompletions = new Map<string, Promise<void>>();

function admissionCompletionKey(admission: MlsJoinAdmission): string {
  return `${admission.roomId}\0${admission.requestId}`;
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

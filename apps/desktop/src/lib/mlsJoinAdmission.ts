import { completeMlsJoinAdmission, type MlsJoinAdmission } from "./mlsClient";
import type { RelayClient } from "./relayClient";
import { acknowledgeDirectedInviteResponse } from "./workspaceClient";

interface AdmissionDependencies {
  acknowledge: typeof acknowledgeDirectedInviteResponse;
  complete: typeof completeMlsJoinAdmission;
}

const defaultDependencies: AdmissionDependencies = {
  acknowledge: acknowledgeDirectedInviteResponse,
  complete: completeMlsJoinAdmission
};

export async function completeMlsRelayAdmission(
  client: RelayClient,
  admission: MlsJoinAdmission,
  deviceSessionToken: string,
  beforeComplete: () => void | Promise<void> = () => undefined,
  dependencies: AdmissionDependencies = defaultDependencies
): Promise<void> {
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
}

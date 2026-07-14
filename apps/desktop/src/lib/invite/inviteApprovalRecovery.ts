import type { MlsInviteCapabilityBinding, MlsOutboxItem } from "../mlsClient";

export interface PendingInviteApproval {
  epoch: number;
  commitOutboxId: string;
  welcomeOutboxId: string;
  responseBinding: MlsInviteCapabilityBinding;
  responseMac: string;
}

interface ExpectedInviteApproval {
  requestBinding: MlsInviteCapabilityBinding;
  keyPackageId: string;
}

function invalidRecovery(reason: string): never {
  throw new Error(`Native MLS invite approval recovery is invalid: ${reason}.`);
}

function assertResponseBinding(response: MlsInviteCapabilityBinding, request: MlsInviteCapabilityBinding): void {
  if (
    response.version !== request.version ||
    response.phase !== "response" ||
    response.inviteId !== request.inviteId ||
    response.teamId !== request.teamId ||
    response.roomId !== request.roomId ||
    response.keyEpoch !== request.keyEpoch ||
    response.keyPackageHash !== request.keyPackageHash ||
    response.requestId !== request.requestId ||
    response.requestNonce !== request.requestNonce ||
    response.requesterUserId !== request.requesterUserId ||
    response.requesterDeviceId !== request.requesterDeviceId ||
    response.hostUserId !== request.hostUserId ||
    response.hostDeviceId !== request.hostDeviceId ||
    response.expiresAt !== request.expiresAt ||
    response.status !== "approved" ||
    typeof response.decidedAt !== "string" ||
    !response.decidedAt
  ) {
    invalidRecovery("response binding does not match the authenticated request");
  }
}

export function assertInviteApprovalEpoch(
  currentEpoch: number,
  requestEpoch: number,
  recoveredApproval?: PendingInviteApproval
): void {
  if (!recoveredApproval) {
    if (currentEpoch !== requestEpoch) throw new Error("Invite expired after the MLS epoch changed.");
    return;
  }
  const expectedEpoch = recoveredApproval.commitOutboxId ? requestEpoch : recoveredApproval.epoch;
  if (currentEpoch !== expectedEpoch) {
    invalidRecovery("local group epoch does not match the persisted approval");
  }
}

export function recoverInviteApproval(
  outbox: readonly MlsOutboxItem[],
  expected: ExpectedInviteApproval
): PendingInviteApproval | undefined {
  const { requestBinding, keyPackageId } = expected;
  const matchingWelcomes = outbox.filter(
    (item) =>
      item.kind === "welcome" &&
      item.metadata?.type === "welcome" &&
      item.metadata.requestId === requestBinding.requestId
  );
  if (matchingWelcomes.length === 0) return undefined;
  if (matchingWelcomes.length !== 1) invalidRecovery("multiple Welcome records match the request");

  const welcome = matchingWelcomes[0]!;
  const metadata = welcome.metadata;
  if (metadata?.type !== "welcome") invalidRecovery("Welcome metadata is missing");
  if (
    welcome.roomId !== requestBinding.roomId ||
    welcome.epoch !== requestBinding.keyEpoch + 1 ||
    metadata.inviteId !== requestBinding.inviteId ||
    metadata.requestId !== requestBinding.requestId ||
    metadata.requesterUserId !== requestBinding.requesterUserId ||
    metadata.requesterDeviceId !== requestBinding.requesterDeviceId ||
    metadata.keyPackageId !== keyPackageId ||
    metadata.keyPackageHash !== requestBinding.keyPackageHash ||
    typeof metadata.responseMac !== "string" ||
    !metadata.responseMac
  ) {
    invalidRecovery("Welcome metadata does not match the authenticated request");
  }
  assertResponseBinding(metadata.responseBinding, requestBinding);

  const matchingCommits = outbox.filter(
    (item) => item.roomId === requestBinding.roomId && item.epoch === welcome.epoch && item.metadata?.type === "commit"
  );
  if (matchingCommits.length > 1) invalidRecovery("multiple commits match the Welcome epoch");
  const commit = matchingCommits[0];
  if (commit?.metadata?.type === "commit" && commit.metadata.parentEpoch !== requestBinding.keyEpoch) {
    invalidRecovery("commit parent epoch does not match the authenticated request");
  }

  return {
    epoch: welcome.epoch,
    commitOutboxId: commit?.id ?? "",
    welcomeOutboxId: welcome.id,
    responseBinding: metadata.responseBinding,
    responseMac: metadata.responseMac
  };
}

import type { MlsRelayMessage } from "@multaiplayer/protocol";
import type { MlsGroupState } from "../mls/mlsClient";
import type { HostHandoffRecord } from "../../types";

export interface HostCandidateBinding {
  candidateUserId: string;
  candidateDeviceId: string;
  candidateLeaf: number;
}

export type HostHandoffRecordTransition =
  | { type: "candidate-requested"; candidate: HostCandidateBinding }
  | { type: "transfer-committed"; acceptedByUserId?: string; acceptedAt?: string }
  | { type: "patch-applied" };

export function preferredHostCandidate(
  current: HostCandidateBinding | null,
  proposed: HostCandidateBinding
): HostCandidateBinding {
  if (!current) return proposed;
  return candidateKey(current) <= candidateKey(proposed) ? current : proposed;
}

export function transitionHostHandoffRecord(
  handoff: HostHandoffRecord,
  transition: HostHandoffRecordTransition
): HostHandoffRecord {
  if (transition.type === "candidate-requested") {
    if (handoff.status !== "available" && handoff.status !== "requested") return handoff;
    const current = candidateBinding(handoff);
    if (preferredHostCandidate(current, transition.candidate) === current) return handoff;
    return { ...handoff, ...transition.candidate, status: "requested" };
  }
  if (transition.type === "transfer-committed") {
    return {
      ...handoff,
      status: "accepted",
      ...(transition.acceptedByUserId ? { acceptedByUserId: transition.acceptedByUserId } : {}),
      ...(transition.acceptedAt ? { acceptedAt: transition.acceptedAt } : {})
    };
  }
  if (handoff.status !== "accepted" || handoff.patchAppliedLocally) return handoff;
  return { ...handoff, patchAppliedLocally: true };
}

export function committedTransferMatchesOffer(
  envelope: MlsRelayMessage,
  group: MlsGroupState,
  offer: HostHandoffRecord | undefined
): offer is HostHandoffRecord {
  const authorization = envelope.hostTransferAuthorization;
  return Boolean(
    authorization &&
    offer &&
    envelope.messageType === "commit" &&
    envelope.commitEffect === "host_handoff" &&
    group.epoch === envelope.epochHint + 1 &&
    group.hostTransferId === authorization.transferId &&
    group.hostLeaf === authorization.nextHostLeaf &&
    group.hostDeviceId === authorization.nextHostDeviceId &&
    offer.id === authorization.transferId &&
    offer.fromUserId === authorization.outgoingHostUserId &&
    offer.candidateUserId === authorization.nextHostUserId &&
    offer.candidateDeviceId === authorization.nextHostDeviceId &&
    offer.candidateLeaf === authorization.nextHostLeaf
  );
}

function candidateKey(candidate: HostCandidateBinding): string {
  return `${candidate.candidateUserId}\0${candidate.candidateDeviceId}\0${candidate.candidateLeaf}`;
}

function candidateBinding(handoff: HostHandoffRecord): HostCandidateBinding | null {
  return handoff.candidateUserId && handoff.candidateDeviceId && handoff.candidateLeaf !== undefined
    ? {
        candidateUserId: handoff.candidateUserId,
        candidateDeviceId: handoff.candidateDeviceId,
        candidateLeaf: handoff.candidateLeaf
      }
    : null;
}

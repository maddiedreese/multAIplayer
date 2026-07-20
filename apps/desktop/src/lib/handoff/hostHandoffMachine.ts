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
    commitEnvelopeMatchesAuthorization(envelope, authorization) &&
    committedGroupMatchesAuthorization(group, envelope, authorization) &&
    requestedOfferMatchesAuthorization(offer, authorization)
  );
}

export function acceptedHandoffMatchesOffer(
  sender: Pick<MlsRelayMessage, "senderUserId" | "senderDeviceId">,
  accepted: {
    hostUserId: string;
    hostDeviceId: string;
    hostLeaf: number;
  },
  offer: HostHandoffRecord | undefined
): offer is HostHandoffRecord {
  return Boolean(
    offer &&
    offer.status === "requested" &&
    offer.fromUserId === sender.senderUserId &&
    offer.fromDeviceId === sender.senderDeviceId &&
    offer.candidateUserId === accepted.hostUserId &&
    offer.candidateDeviceId === accepted.hostDeviceId &&
    offer.candidateLeaf === accepted.hostLeaf
  );
}

function candidateKey(candidate: HostCandidateBinding): string {
  return `${candidate.candidateUserId}\0${candidate.candidateDeviceId}\0${candidate.candidateLeaf}`;
}

type HostTransferAuthorization = NonNullable<MlsRelayMessage["hostTransferAuthorization"]>;

function commitEnvelopeMatchesAuthorization(
  envelope: MlsRelayMessage,
  authorization: HostTransferAuthorization
): boolean {
  return (
    envelope.messageType === "commit" &&
    envelope.commitEffect === "host_handoff" &&
    authorization.roomId === envelope.roomId &&
    authorization.commitMessageId === envelope.id &&
    authorization.parentEpoch === envelope.epochHint &&
    authorization.outgoingHostUserId === envelope.senderUserId &&
    authorization.outgoingHostDeviceId === envelope.senderDeviceId &&
    authorization.nextHostUserId === envelope.nextHostUserId &&
    authorization.nextHostDeviceId === envelope.nextHostDeviceId
  );
}

function committedGroupMatchesAuthorization(
  group: MlsGroupState,
  envelope: MlsRelayMessage,
  authorization: HostTransferAuthorization
): boolean {
  const committedHost = group.roster.find((member) => member.leaf === authorization.nextHostLeaf);
  return (
    group.epoch === envelope.epochHint + 1 &&
    group.hostTransferId === authorization.transferId &&
    group.hostLeaf === authorization.nextHostLeaf &&
    group.hostDeviceId === authorization.nextHostDeviceId &&
    committedHost?.githubUserId === authorization.nextHostUserId &&
    committedHost.deviceId === authorization.nextHostDeviceId
  );
}

function requestedOfferMatchesAuthorization(
  offer: HostHandoffRecord,
  authorization: HostTransferAuthorization
): boolean {
  return (
    offer.status === "requested" &&
    offer.id === authorization.transferId &&
    offer.fromUserId === authorization.outgoingHostUserId &&
    offer.fromDeviceId === authorization.outgoingHostDeviceId &&
    offer.candidateUserId === authorization.nextHostUserId &&
    offer.candidateDeviceId === authorization.nextHostDeviceId &&
    offer.candidateLeaf === authorization.nextHostLeaf
  );
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

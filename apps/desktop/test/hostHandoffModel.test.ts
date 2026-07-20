import { defaultTestHandoff } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { MlsRelayMessage } from "@multaiplayer/protocol";
import {
  acceptedHandoffMatchesOffer,
  committedTransferMatchesOffer,
  transitionHostHandoffRecord,
  type HostCandidateBinding
} from "../src/lib/handoff/hostHandoffMachine";
import type { HostHandoffRecord } from "../src/types";

const candidates = {
  "candidate-a": { candidateUserId: "user-a", candidateDeviceId: "device-a", candidateLeaf: 1 },
  "candidate-b": { candidateUserId: "user-b", candidateDeviceId: "device-b", candidateLeaf: 2 }
} satisfies Record<"candidate-a" | "candidate-b", HostCandidateBinding>;

const availableOffer: HostHandoffRecord = {
  ...defaultTestHandoff,
  id: "offer-model",
  fromHost: "Outgoing host",
  fromUserId: "user-host",
  projectPath: "/model/project",
  codexModel: "gpt-5.5",
  approvalPolicy: "ask_every_turn",
  messagesSinceLastCodex: 0,
  attachmentNames: [],
  terminals: [],
  createdAt: "2026-07-14T00:00:00.000Z",
  status: "available"
};

test("candidate selection converges regardless of delivery order", () => {
  const aThenB = transitionHostHandoffRecord(
    transitionHostHandoffRecord(availableOffer, { type: "candidate-requested", candidate: candidates["candidate-a"] }),
    { type: "candidate-requested", candidate: candidates["candidate-b"] }
  );
  const bThenA = transitionHostHandoffRecord(
    transitionHostHandoffRecord(availableOffer, { type: "candidate-requested", candidate: candidates["candidate-b"] }),
    { type: "candidate-requested", candidate: candidates["candidate-a"] }
  );
  assert.deepEqual(aThenB, bThenA);
});

test("production record transitions reject candidate or patch changes outside their authority phase", () => {
  assert.equal(transitionHostHandoffRecord(availableOffer, { type: "patch-applied" }), availableOffer);
  const accepted = transitionHostHandoffRecord(availableOffer, { type: "transfer-committed" });
  assert.equal(
    transitionHostHandoffRecord(accepted, {
      type: "candidate-requested",
      candidate: candidates["candidate-a"]
    }),
    accepted
  );
});

test("commit correlation requires the native authenticated transfer id and exact candidate binding", () => {
  const offer: HostHandoffRecord = {
    ...defaultTestHandoff,
    id: "offer-1",
    fromHost: "Host",
    fromUserId: "user-host",
    projectPath: "/tmp/project",
    codexModel: "gpt-5.5",
    approvalPolicy: "ask_every_turn",
    messagesSinceLastCodex: 0,
    attachmentNames: [],
    terminals: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    status: "requested",
    fromDeviceId: "device-host",
    candidateUserId: "user-a",
    candidateDeviceId: "device-a",
    candidateLeaf: 1
  };
  const envelope = {
    id: "a".repeat(64),
    teamId: "team-1",
    roomId: "room-1",
    senderUserId: "user-host",
    senderDeviceId: "device-host",
    createdAt: "2026-07-14T00:01:00.000Z",
    messageType: "commit",
    epochHint: 7,
    mlsMessage: "AA==",
    commitEffect: "host_handoff",
    nextHostUserId: "user-a",
    nextHostDeviceId: "device-a",
    hostTransferAuthorization: {
      version: 2,
      transferId: "offer-1",
      roomId: "room-1",
      commitMessageId: "a".repeat(64),
      parentEpoch: 7,
      outgoingHostUserId: "user-host",
      outgoingHostDeviceId: "device-host",
      nextHostUserId: "user-a",
      nextHostDeviceId: "device-a",
      nextHostLeaf: 1,
      signatureDer: "AA==",
      publicKeySpkiDer: "AA=="
    }
  } satisfies MlsRelayMessage;
  const group = {
    roster: [
      {
        leaf: 1,
        githubUserId: "user-a",
        deviceId: "device-a"
      }
    ],
    selfLeaf: 1,
    epoch: 8,
    hostLeaf: 1,
    hostDeviceId: "device-a",
    hostTransferId: "offer-1"
  };
  assert.equal(committedTransferMatchesOffer(envelope, group, offer), true);
  assert.equal(committedTransferMatchesOffer(envelope, { ...group, hostTransferId: "other" }, offer), false);
  assert.equal(committedTransferMatchesOffer(envelope, group, { ...offer, candidateLeaf: 2 }), false);
  assert.equal(committedTransferMatchesOffer(envelope, group, { ...offer, fromDeviceId: "device-attacker" }), false);
  const { fromDeviceId: _fromDeviceId, ...offerWithoutDevice } = offer;
  assert.equal(committedTransferMatchesOffer(envelope, group, offerWithoutDevice), false);
  assert.equal(committedTransferMatchesOffer({ ...envelope, senderDeviceId: "device-attacker" }, group, offer), false);
  assert.equal(
    committedTransferMatchesOffer({ ...envelope, nextHostDeviceId: "device-attacker" }, group, offer),
    false
  );
  assert.equal(
    committedTransferMatchesOffer(
      envelope,
      {
        ...group,
        roster: [
          {
            leaf: 1,
            githubUserId: "user-attacker",
            deviceId: "device-a"
          }
        ]
      },
      offer
    ),
    false
  );
});

test("accepted event requires the exact authenticated outgoing device and requested candidate", () => {
  const offer: HostHandoffRecord = {
    ...availableOffer,
    fromDeviceId: "device-host",
    status: "requested",
    candidateUserId: "user-a",
    candidateDeviceId: "device-a",
    candidateLeaf: 1
  };
  const sender = { senderUserId: "user-host", senderDeviceId: "device-host" };
  const accepted = { hostUserId: "user-a", hostDeviceId: "device-a", hostLeaf: 1 };

  assert.equal(acceptedHandoffMatchesOffer(sender, accepted, offer), true);
  assert.equal(acceptedHandoffMatchesOffer({ ...sender, senderDeviceId: "device-attacker" }, accepted, offer), false);
  assert.equal(acceptedHandoffMatchesOffer(sender, { ...accepted, hostDeviceId: "device-attacker" }, offer), false);
  const { fromDeviceId: _fromDeviceId, ...offerWithoutDevice } = offer;
  assert.equal(acceptedHandoffMatchesOffer(sender, accepted, offerWithoutDevice), false);
});

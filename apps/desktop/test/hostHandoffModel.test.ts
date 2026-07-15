import assert from "node:assert/strict";
import test from "node:test";
import type { MlsRelayMessage } from "@multaiplayer/protocol";
import {
  committedTransferMatchesOffer,
  transitionHostHandoffRecord,
  type HostCandidateBinding
} from "../src/lib/handoff/hostHandoffMachine";
import type { HostHandoffRecord } from "../src/types";

type Authority = "outgoing" | "candidate-a" | "candidate-b";
type Action =
  | "offer"
  | "request-a"
  | "request-b"
  | "commit"
  | "crash-outgoing"
  | "deliver-accepted-event"
  | "recover-from-commit"
  | "approve-staged-patch"
  | "old-host-action";

interface ModelState {
  authority: Authority;
  epoch: number;
  handoff: HostHandoffRecord | null;
  committedTransfer: boolean;
  outgoingAlive: boolean;
  oldHostActionRan: boolean;
}

const candidates = {
  "candidate-a": { candidateUserId: "user-a", candidateDeviceId: "device-a", candidateLeaf: 1 },
  "candidate-b": { candidateUserId: "user-b", candidateDeviceId: "device-b", candidateLeaf: 2 }
} satisfies Record<"candidate-a" | "candidate-b", HostCandidateBinding>;

const actions: Action[] = [
  "offer",
  "request-a",
  "request-b",
  "commit",
  "crash-outgoing",
  "deliver-accepted-event",
  "recover-from-commit",
  "approve-staged-patch",
  "old-host-action"
];

const modelOffer: HostHandoffRecord = {
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

test("bounded exhaustive host-handoff interleavings preserve authority and recover after a crash", () => {
  const initial: ModelState = {
    authority: "outgoing",
    epoch: 7,
    handoff: null,
    committedTransfer: false,
    outgoingAlive: true,
    oldHostActionRan: false
  };
  const queue: Array<{ state: ModelState; depth: number }> = [{ state: initial, depth: 0 }];
  const seen = new Set<string>();
  let recoveredCrashState = false;
  while (queue.length) {
    const current = queue.shift()!;
    const key = JSON.stringify(current.state);
    if (seen.has(key)) continue;
    seen.add(key);
    assertInvariants(current.state);
    if (!current.state.outgoingAlive && current.state.committedTransfer && current.state.handoff?.status === "accepted")
      recoveredCrashState = true;
    if (current.depth === 9) continue;
    for (const action of actions) {
      const next = step(current.state, action);
      if (next) queue.push({ state: next, depth: current.depth + 1 });
    }
  }
  assert.ok(seen.size > 20, `expected a meaningful state graph, explored ${seen.size}`);
  assert.equal(recoveredCrashState, true, "durable committed transfer must recover without the accepted event");
});

test("candidate selection converges regardless of delivery order", () => {
  const aThenB = transitionHostHandoffRecord(
    transitionHostHandoffRecord(modelOffer, { type: "candidate-requested", candidate: candidates["candidate-a"] }),
    { type: "candidate-requested", candidate: candidates["candidate-b"] }
  );
  const bThenA = transitionHostHandoffRecord(
    transitionHostHandoffRecord(modelOffer, { type: "candidate-requested", candidate: candidates["candidate-b"] }),
    { type: "candidate-requested", candidate: candidates["candidate-a"] }
  );
  assert.deepEqual(aThenB, bThenA);
});

test("production record transitions reject candidate or patch changes outside their authority phase", () => {
  assert.equal(transitionHostHandoffRecord(modelOffer, { type: "patch-applied" }), modelOffer);
  const accepted = transitionHostHandoffRecord(modelOffer, { type: "transfer-committed" });
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
    candidateUserId: "user-a",
    candidateDeviceId: "device-a",
    candidateLeaf: 1
  };
  const envelope = {
    id: "commit-1",
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
    roster: [],
    selfLeaf: 1,
    epoch: 8,
    hostLeaf: 1,
    hostDeviceId: "device-a",
    hostTransferId: "offer-1"
  };
  assert.equal(committedTransferMatchesOffer(envelope, group, offer), true);
  assert.equal(committedTransferMatchesOffer(envelope, { ...group, hostTransferId: "other" }, offer), false);
  assert.equal(committedTransferMatchesOffer(envelope, group, { ...offer, candidateLeaf: 2 }), false);
});

function step(state: ModelState, action: Action): ModelState | null {
  if (action === "offer" && state.authority === "outgoing" && !state.handoff) return { ...state, handoff: modelOffer };
  if ((action === "request-a" || action === "request-b") && state.handoff && !state.committedTransfer) {
    const proposed = candidates[action === "request-a" ? "candidate-a" : "candidate-b"];
    const handoff = transitionHostHandoffRecord(state.handoff, { type: "candidate-requested", candidate: proposed });
    return handoff === state.handoff ? null : { ...state, handoff };
  }
  if (
    action === "commit" &&
    state.authority === "outgoing" &&
    state.handoff?.status === "requested" &&
    state.outgoingAlive
  ) {
    const authority = state.handoff.candidateUserId === "user-a" ? "candidate-a" : "candidate-b";
    return { ...state, authority, epoch: state.epoch + 1, committedTransfer: true, oldHostActionRan: false };
  }
  if (action === "crash-outgoing" && state.outgoingAlive) return { ...state, outgoingAlive: false };
  if (
    action === "deliver-accepted-event" &&
    state.outgoingAlive &&
    state.committedTransfer &&
    state.handoff?.status === "requested"
  )
    return {
      ...state,
      handoff: transitionHostHandoffRecord(state.handoff, { type: "transfer-committed" })
    };
  if (action === "recover-from-commit" && state.committedTransfer && state.handoff?.status === "requested")
    return {
      ...state,
      handoff: transitionHostHandoffRecord(state.handoff, { type: "transfer-committed" })
    };
  if (action === "approve-staged-patch" && state.handoff?.status === "accepted" && !state.handoff.patchAppliedLocally)
    return { ...state, handoff: transitionHostHandoffRecord(state.handoff, { type: "patch-applied" }) };
  if (action === "old-host-action" && state.authority === "outgoing") return { ...state, oldHostActionRan: true };
  return null;
}

function assertInvariants(state: ModelState): void {
  assert.equal(state.epoch, state.committedTransfer ? 8 : 7);
  if (state.committedTransfer) assert.notEqual(state.authority, "outgoing");
  if (state.handoff?.status === "accepted") assert.equal(state.committedTransfer, true);
  if (state.handoff?.patchAppliedLocally) assert.equal(state.handoff.status, "accepted");
  if (state.authority !== "outgoing") assert.equal(state.oldHostActionRan, false);
}

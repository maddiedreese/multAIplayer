import assert from "node:assert/strict";
import test from "node:test";
import { parseInviteInput } from "../src/lib/invite/inviteActionsHelpers";
import { InviteJoinError } from "../src/lib/invite/inviteJoinError";

function hasInviteCode(code: InviteJoinError["code"]) {
  return (error: unknown) => error instanceof InviteJoinError && error.code === code;
}

test("only host-approved invite fragments are accepted", () => {
  assert.deepEqual(
    parseInviteInput("https://app.example/rooms#invite=invite-new&multaiplayerJoin=capability&approval=request"),
    { inviteId: "invite-new", joinInvite: "capability" }
  );
  assert.throws(() => parseInviteInput("not-an-invite"), hasInviteCode("invalid_invite"));
});

test("manual paste rejects non-current and ambiguous invite forms", () => {
  assert.throws(
    () => parseInviteInput("https://app.example/rooms?invite=invite-old#multaiplayerJoin=capability&approval=request"),
    hasInviteCode("invalid_invite")
  );
  assert.throws(
    () =>
      parseInviteInput("https://app.example/rooms?invite=one#invite=two&multaiplayerJoin=capability&approval=request"),
    hasInviteCode("invalid_invite")
  );
  for (const ambiguous of [
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&multaiplayerJoin=other&approval=request",
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&approval=request&extra=value",
    "https://app.example/rooms?invite=one&extra=value#multaiplayerJoin=capability&approval=request",
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&approval=other"
  ]) {
    assert.throws(() => parseInviteInput(ambiguous), hasInviteCode("invalid_invite"));
  }
});

test("manual paste enforces the same complete-link bound as native and website intake", () => {
  assert.throws(
    () => parseInviteInput(`https://open.multaiplayer.com/invite#${"a".repeat(12_289)}`),
    hasInviteCode("invalid_invite")
  );
});

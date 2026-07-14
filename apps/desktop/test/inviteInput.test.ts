import assert from "node:assert/strict";
import test from "node:test";
import { parseInviteInput } from "../src/lib/inviteActionsHelpers";

test("pasted legacy room-key invites are rejected with safe recovery guidance", () => {
  assert.throws(
    () => parseInviteInput("https://app.example/rooms#invite=invite-old&multaiplayerInvite=raw-room-key"),
    /pre-v2 invite is invalid.*Ask the active host for a new MLS invite/i
  );
});

test("only host-approved invite fragments are accepted", () => {
  assert.deepEqual(
    parseInviteInput("https://app.example/rooms#invite=invite-new&multaiplayerJoin=capability&approval=request"),
    { inviteId: "invite-new", joinInvite: "capability" }
  );
  assert.throws(() => parseInviteInput("not-an-invite"), /complete host-approved multAIplayer invite link/);
});

test("manual paste temporarily accepts the immediately prior query-id link without ambiguity", () => {
  assert.deepEqual(
    parseInviteInput("https://app.example/rooms?invite=invite-old#multaiplayerJoin=capability&approval=request"),
    { inviteId: "invite-old", joinInvite: "capability" }
  );
  assert.throws(
    () =>
      parseInviteInput("https://app.example/rooms?invite=one#invite=two&multaiplayerJoin=capability&approval=request"),
    /complete host-approved/
  );
  for (const ambiguous of [
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&multaiplayerJoin=other&approval=request",
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&approval=request&extra=value",
    "https://app.example/rooms?invite=one&extra=value#multaiplayerJoin=capability&approval=request",
    "https://app.example/rooms#invite=one&multaiplayerJoin=capability&approval=other"
  ]) {
    assert.throws(() => parseInviteInput(ambiguous), /complete host-approved/);
  }
});

test("manual paste enforces the same complete-link bound as native and website intake", () => {
  assert.throws(
    () => parseInviteInput(`https://open.multaiplayer.com/invite#${"a".repeat(12_289)}`),
    /complete host-approved/
  );
});

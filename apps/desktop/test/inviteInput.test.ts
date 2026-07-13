import assert from "node:assert/strict";
import test from "node:test";
import { parseInviteInput } from "../src/lib/inviteActionsHelpers";

test("pasted legacy room-key invites are rejected with safe recovery guidance", () => {
  assert.throws(
    () => parseInviteInput("https://app.example/rooms?invite=invite-old#multaiplayerInvite=raw-room-key"),
    /pre-v2 invite is invalid.*Ask the active host for a new MLS invite/i
  );
});

test("only host-approved invite fragments are accepted", () => {
  assert.deepEqual(
    parseInviteInput("https://app.example/rooms?invite=invite-new#multaiplayerJoin=capability&approval=request"),
    { inviteId: "invite-new", joinInvite: "capability" }
  );
  assert.throws(() => parseInviteInput("not-an-invite"), /complete host-approved multAIplayer invite link/);
});

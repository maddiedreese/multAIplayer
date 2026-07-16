import assert from "node:assert/strict";
import test from "node:test";
import { readInviteUrlPayload } from "../src/lib/invite/inviteUrl";

test("readInviteUrlPayload parses gated no-secret invite URLs", () => {
  assert.deepEqual(
    readInviteUrlPayload({
      pathname: "/rooms",
      search: "",
      hash: "#invite=invite_123&multaiplayerJoin=encoded-join&approval=request"
    }),
    {
      kind: "join",
      encoded: "encoded-join",
      inviteId: "invite_123",
      cleanupPath: "/rooms"
    }
  );
});

test("readInviteUrlPayload ignores obsolete room-key invites", () => {
  assert.equal(
    readInviteUrlPayload({
      pathname: "/",
      search: "",
      hash: "#invite=invite_456&multaiplayerInvite=encoded-secret"
    }),
    null
  );
});

test("readInviteUrlPayload ignores non-invite fragments", () => {
  assert.equal(
    readInviteUrlPayload({
      pathname: "/",
      search: "",
      hash: "#settings"
    }),
    null
  );
});

test("readInviteUrlPayload rejects incomplete, ambiguous, and non-current fragments", () => {
  for (const hash of [
    "#multaiplayerJoin=encoded-join&approval=request",
    "#invite=invite_123&approval=request",
    "#invite=invite_123&multaiplayerJoin=encoded-join",
    "#invite=invite_123&multaiplayerJoin=encoded-join&approval=other",
    "#invite=&multaiplayerJoin=encoded-join&approval=request",
    "#invite=invite_123&multaiplayerJoin=&approval=request",
    "#invite=invite_123&invite=other&multaiplayerJoin=encoded-join&approval=request",
    "#invite=invite_123&multaiplayerJoin=encoded-join&multaiplayerJoin=other&approval=request",
    "#invite=invite_123&multaiplayerJoin=encoded-join&approval=request&approval=request",
    "#invite=invite_123&multaiplayerJoin=encoded-join&approval=request&extra=value"
  ]) {
    assert.equal(readInviteUrlPayload({ pathname: "/", search: "", hash }), null);
  }
});

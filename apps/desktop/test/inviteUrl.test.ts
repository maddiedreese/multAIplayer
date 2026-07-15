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
      approvalRequested: true,
      cleanupPath: "/rooms"
    }
  );
});

test("readInviteUrlPayload recognizes legacy room-key invites only so callers can scrub and reject them", () => {
  assert.deepEqual(
    readInviteUrlPayload({
      pathname: "/",
      search: "",
      hash: "#invite=invite_456&multaiplayerInvite=encoded-secret"
    }),
    {
      kind: "legacy-secret",
      cleanupPath: "/"
    }
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

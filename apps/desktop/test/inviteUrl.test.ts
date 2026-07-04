import assert from "node:assert/strict";
import test from "node:test";
import { readInviteUrlPayload } from "../src/lib/inviteUrl";

test("readInviteUrlPayload parses gated no-secret invite URLs", () => {
  assert.deepEqual(
    readInviteUrlPayload({
      pathname: "/rooms",
      search: "?invite=invite_123",
      hash: "#multaiplayerJoin=encoded-join&approval=request"
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

test("readInviteUrlPayload parses direct room-key invite URLs", () => {
  assert.deepEqual(
    readInviteUrlPayload({
      pathname: "/",
      search: "?invite=invite_456",
      hash: "#multaiplayerInvite=encoded-secret"
    }),
    {
      kind: "secret",
      encoded: "encoded-secret",
      inviteId: "invite_456",
      approvalRequested: false,
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

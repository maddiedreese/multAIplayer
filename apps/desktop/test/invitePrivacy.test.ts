import assert from "node:assert/strict";
import test from "node:test";
import { displayableInviteLink } from "../src/lib/invitePrivacy";

test("displayableInviteLink hides direct room-key invite links", () => {
  assert.equal(displayableInviteLink("https://app/#multaiplayerInvite=secret", true), "");
});

test("displayableInviteLink keeps gated no-secret invite links visible", () => {
  assert.equal(
    displayableInviteLink("https://app/#multaiplayerJoin=metadata", false),
    "https://app/#multaiplayerJoin=metadata"
  );
});

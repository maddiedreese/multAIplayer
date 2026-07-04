import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentReviewMessage,
  attachmentReviewScopeKey,
  decideAttachmentReview,
  reviewedAttachmentPathForScope
} from "../src/lib/attachmentPolicy";

test("ordinary files can be attached without extra review", () => {
  assert.deepEqual(decideAttachmentReview("const ok = true;\nconsole.log(ok);", "src/app.ts", null), {
    risks: [],
    requiresReview: false,
    reviewed: false,
    canAttach: true,
    actionLabel: "Attach",
    warningDetail: null
  });
});

test("sensitive file paths require review before attachment", () => {
  const first = decideAttachmentReview("DATABASE_URL=postgres://example", ".env.local", null);

  assert.deepEqual(first.risks, ["Sensitive file access", "Environment variables"]);
  assert.equal(first.requiresReview, true);
  assert.equal(first.reviewed, false);
  assert.equal(first.canAttach, false);
  assert.equal(first.actionLabel, "Review");
  assert.equal(first.warningDetail, "Review is required before this file can be attached.");

  const reviewed = decideAttachmentReview("DATABASE_URL=postgres://example", ".env.local", ".env.local");
  assert.equal(reviewed.canAttach, true);
  assert.equal(reviewed.actionLabel, "Attach anyway");
  assert.equal(reviewed.warningDetail, "Click Attach anyway to share this file preview.");
});

test("credential-looking content requires review even in normal paths", () => {
  const decision = decideAttachmentReview("api_token: redacted-but-still-sensitive-looking", "notes.txt", null);

  assert.deepEqual(decision.risks, ["Credential-looking output"]);
  assert.equal(decision.canAttach, false);
  assert.match(attachmentReviewMessage("notes.txt", decision.risks), /credential-looking output/);
});

test("attachment review acknowledgement is scoped to room, project, and path", () => {
  const reviewKey = attachmentReviewScopeKey("room-a", "/project-a", ".env.local");

  assert.equal(reviewedAttachmentPathForScope(reviewKey, "room-a", "/project-a", ".env.local"), ".env.local");
  assert.equal(reviewedAttachmentPathForScope(reviewKey, "room-b", "/project-a", ".env.local"), null);
  assert.equal(reviewedAttachmentPathForScope(reviewKey, "room-a", "/project-b", ".env.local"), null);
  assert.equal(reviewedAttachmentPathForScope(reviewKey, "room-a", "/project-a", "nested/.env.local"), null);
});

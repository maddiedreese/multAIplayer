import assert from "node:assert/strict";
import test from "node:test";
import { messageInvokesCodex } from "../src/lib/codexInvoke";

test("messageInvokesCodex accepts explicit Codex mentions case-insensitively", () => {
  assert.equal(messageInvokesCodex("@Codex please review this diff"), true);
  assert.equal(messageInvokesCodex("could @codex run tests?"), true);
  assert.equal(messageInvokesCodex("ship it, @CODEX."), true);
});

test("messageInvokesCodex rejects ordinary words and longer handles", () => {
  assert.equal(messageInvokesCodex("codex should not run yet"), false);
  assert.equal(messageInvokesCodex("@codexish should not run"), false);
  assert.equal(messageInvokesCodex("maddie@example.com @code"), false);
});

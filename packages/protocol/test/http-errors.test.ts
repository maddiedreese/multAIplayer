import assert from "node:assert/strict";
import test from "node:test";
import { RelayHttpErrorCode, RelayHttpErrorResponse } from "../src/index.js";

test("relay HTTP errors expose stable discriminants and allow bounded context fields", () => {
  assert.equal(RelayHttpErrorCode.parse("authentication_required"), "authentication_required");
  assert.equal(
    RelayHttpErrorResponse.parse({
      error: "Slow down before retrying.",
      code: "rate_limited",
      retryAfterSeconds: 5
    }).retryAfterSeconds,
    5
  );
  assert.equal(RelayHttpErrorCode.safeParse("a prose message").success, false);
  assert.equal(RelayHttpErrorResponse.safeParse({ error: "Missing code" }).success, false);
});

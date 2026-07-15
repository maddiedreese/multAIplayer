import assert from "node:assert/strict";
import test from "node:test";
import {
  codexSteeringInput,
  defaultCodexFollowUpBehavior,
  loadCodexFollowUpBehavior,
  saveCodexFollowUpBehavior
} from "../src/lib/codex/codexFollowUpBehavior.js";

test("follow-up behavior defaults to steering and preserves supported choices", () => {
  assert.equal(loadCodexFollowUpBehavior(null), defaultCodexFollowUpBehavior);
  assert.equal(loadCodexFollowUpBehavior({ getItem: () => "queue" }), "queue");
  assert.equal(loadCodexFollowUpBehavior({ getItem: () => "invalid" }), "steer");
  let saved = "";
  saveCodexFollowUpBehavior("queue", { setItem: (_key, value) => (saved = value) });
  assert.equal(saved, "queue");
});

test("follow-up behavior stays usable when local preference storage is unavailable", () => {
  assert.equal(
    loadCodexFollowUpBehavior({
      getItem: () => {
        throw new Error("storage denied");
      }
    }),
    defaultCodexFollowUpBehavior
  );
  assert.doesNotThrow(() =>
    saveCodexFollowUpBehavior("queue", {
      setItem: () => {
        throw new Error("storage full");
      }
    })
  );
});

test("steering input removes only the leading Codex invocation", () => {
  assert.equal(codexSteeringInput("@Codex change the API first"), "change the API first");
  assert.equal(codexSteeringInput("  @codex: keep the tests"), "keep the tests");
  assert.equal(codexSteeringInput("Discuss @Codex behavior"), "Discuss @Codex behavior");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  hasBlockingOnboardingReadiness,
  onboardingJoinIsPending,
  onboardingJoinTitle,
  orderOnboardingReadinessRows,
  successfulAuthenticationReadyToAdvance
} from "../src/application/onboarding/onboardingAssistantModel";
import type { OnboardingReadinessRow } from "../src/application/onboarding/onboardingReadiness";

function row(
  id: OnboardingReadinessRow["id"],
  status: OnboardingReadinessRow["status"],
  blocking = status === "blocked"
): OnboardingReadinessRow {
  return { id, label: id, status, text: `${id} ${status}`, blocking, warning: status === "warning", action: null };
}

const readyRows = [
  row("relay", "ready"),
  row("github", "ready"),
  row("codex", "ready"),
  row("chatgpt", "ready"),
  row("project", "warning", false)
];

test("readiness model restores canonical order and fails closed when a row is missing", () => {
  const reversed = [...readyRows].reverse();
  assert.deepEqual(
    orderOnboardingReadinessRows(reversed).map((item) => item.id),
    ["relay", "github", "codex", "chatgpt", "project"]
  );
  assert.equal(hasBlockingOnboardingReadiness(readyRows), false);
  assert.equal(hasBlockingOnboardingReadiness(readyRows.slice(1)), true);
});

test("a successful attempted authentication advances after it clears the final blocker", () => {
  const previous = readyRows.map((item) =>
    item.id === "github" ? { ...item, status: "blocked" as const, blocking: true } : item
  );
  assert.equal(
    successfulAuthenticationReadyToAdvance({
      previousRows: previous,
      currentRows: readyRows,
      attemptedProviders: new Set(["github"])
    }),
    true
  );
});

test("automatic progression ignores bootstrap, unattempted auth, warnings, and remaining blockers", () => {
  const previous = readyRows.map((item) =>
    item.id === "github" ? { ...item, status: "blocked" as const, blocking: true } : item
  );
  assert.equal(
    successfulAuthenticationReadyToAdvance({
      previousRows: null,
      currentRows: readyRows,
      attemptedProviders: new Set(["github"])
    }),
    false
  );
  assert.equal(
    successfulAuthenticationReadyToAdvance({
      previousRows: previous,
      currentRows: readyRows,
      attemptedProviders: new Set()
    }),
    false
  );
  assert.equal(
    successfulAuthenticationReadyToAdvance({
      previousRows: readyRows.map((item) =>
        item.id === "github" ? { ...item, status: "warning" as const, blocking: false } : item
      ),
      currentRows: readyRows.map((item) => (item.id === "github" ? { ...item, status: "warning" as const } : item)),
      attemptedProviders: new Set(["github"])
    }),
    false
  );
  assert.equal(
    successfulAuthenticationReadyToAdvance({
      previousRows: previous,
      currentRows: readyRows.map((item) =>
        item.id === "relay" ? { ...item, status: "blocked" as const, blocking: true } : item
      ),
      attemptedProviders: new Set(["github"])
    }),
    false
  );
});

test("join presentation is derived consistently from its phase", () => {
  assert.equal(onboardingJoinIsPending({ phase: "idle" }, false), false);
  assert.equal(onboardingJoinIsPending({ phase: "verification_required" }, false), true);
  assert.equal(onboardingJoinIsPending({ phase: "error" }, false), false);
  assert.equal(onboardingJoinTitle("verification_required"), "Device verification required");
  assert.equal(onboardingJoinTitle("complete"), "Invite accepted");
});

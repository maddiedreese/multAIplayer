import assert from "node:assert/strict";
import test from "node:test";
import { isSafelySkippableDocumentationPath, nativeJourneyDecision } from "./native-journey-change-policy.mjs";

test("native journey skips only narrowly classified Markdown documentation", () => {
  for (const path of ["README.md", "docs/ci-policy.md", "docs/decisions/example.md", "e2e/README.md"]) {
    assert.equal(isSafelySkippableDocumentationPath(path), true, path);
  }
  assert.deepEqual(nativeJourneyDecision(["README.md", "docs/ci-policy.md"]), {
    run: false,
    reason: "All 2 changed files are safely classified Markdown documentation."
  });
});

test("native journey runs for UI, native, dependency, workflow, and documentation asset changes", () => {
  for (const path of [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src-tauri/src/main.rs",
    "package-lock.json",
    ".github/workflows/ci.yml",
    "docs/screenshot.png",
    "e2e/onboarding.spec.ts",
    "packages/protocol/src/index.ts"
  ]) {
    const decision = nativeJourneyDecision(["docs/ci-policy.md", path]);
    assert.equal(decision.run, true, path);
    assert.match(decision.reason, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("native journey runs conservatively when change classification is unavailable", () => {
  assert.deepEqual(nativeJourneyDecision([]), {
    run: true,
    reason: "No changed-file list was available; running conservatively."
  });
});

test("native journey does not normalize whitespace path lookalikes into documentation", () => {
  for (const path of [" docs/ci-policy.md", "docs/ci-policy.md ", "README.md\t"]) {
    const decision = nativeJourneyDecision([path]);
    assert.equal(decision.run, true, JSON.stringify(path));
  }
});

test("native journey policy keeps workflow output on one bounded line", () => {
  const decision = nativeJourneyDecision([`apps/desktop/${"x".repeat(220)}\noutput=false.ts`]);
  assert.equal(decision.run, true);
  assert.equal(decision.reason.includes("\n"), false);
  assert.ok(decision.reason.length <= 284);
});

import assert from "node:assert/strict";
import test from "node:test";
import { allDomains, classifyChanges } from "./classify-changes.mjs";

test("documentation-only changes do not select executable checks", () => {
  assert.deepEqual(classifyChanges(["README.md", "docs/using-the-app.md"]), {
    documentation: true,
    workflow: false,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false
  });
});

test("relay changes select JavaScript and both relay-backed journeys", () => {
  assert.deepEqual(classifyChanges(["apps/relay/src/server.ts"]), {
    documentation: false,
    workflow: false,
    javascript: true,
    native: false,
    ui_journey: true,
    native_journey: true,
    macos: false
  });
});

test("native changes select native checks without an unrelated UI journey", () => {
  assert.deepEqual(classifyChanges(["apps/desktop/src-tauri/src/lib.rs"]), {
    documentation: true,
    workflow: false,
    javascript: false,
    native: true,
    ui_journey: false,
    native_journey: true,
    macos: true
  });
});

test("workflow changes select policy checks and manual runs can opt into all domains", () => {
  assert.deepEqual(classifyChanges([".github/workflows/supply-chain.yml"]), {
    documentation: false,
    workflow: true,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false
  });
  assert.deepEqual(allDomains(), {
    documentation: true,
    workflow: true,
    javascript: true,
    native: true,
    ui_journey: true,
    native_journey: true,
    macos: true
  });
});

test("documentation checks follow every maintained source of truth", () => {
  for (const path of [
    "README.md",
    "docs/reproducible-builds.md",
    "scripts/check-maintained-docs.mjs",
    "contracts/codex-app-server/support-policy.json",
    "apps/desktop/src-tauri/updater-public.key",
    "apps/desktop/src-tauri/src/lib.rs"
  ]) {
    assert.equal(classifyChanges([path]).documentation, true, `${path} must select documentation checks`);
  }
  assert.equal(classifyChanges(["CONTRIBUTING.md"]).documentation, false);
  const supportPolicy = classifyChanges(["contracts/codex-app-server/support-policy.json"]);
  assert.equal(supportPolicy.javascript, true);
  assert.equal(supportPolicy.native, true);
});

test("GitHub templates are documentation, while workflow code selects workflow checks", () => {
  assert.equal(classifyChanges([".github/ISSUE_TEMPLATE/bug_report.yml"]).workflow, false);
  assert.equal(classifyChanges([".github/actions/setup-rust/action.yml"]).workflow, true);
});

test("changes to CI and its shared detector exercise the definitions being edited", () => {
  const ciWorkflow = classifyChanges([".github/workflows/ci.yml"]);
  assert.equal(ciWorkflow.workflow, true);
  assert.equal(ciWorkflow.javascript, true);
  assert.equal(ciWorkflow.native, true);

  const detector = classifyChanges([".github/actions/changed-domains/action.yml"]);
  assert.equal(detector.workflow, true);
  assert.equal(detector.javascript, true);
});

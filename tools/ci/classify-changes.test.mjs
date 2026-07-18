import assert from "node:assert/strict";
import test from "node:test";
import { allDomains, classifyChanges, protectedReleasePaths } from "./classify-changes.mjs";

test("documentation-only changes do not select executable checks", () => {
  assert.deepEqual(classifyChanges(["README.md", "docs/using-the-app.md", "e2e/README.md"]), {
    documentation: true,
    workflow: false,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false,
    cli: false,
    desktop: false,
    relay: false,
    shared: false,
    protected_release: false
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
    macos: false,
    cli: false,
    desktop: false,
    relay: true,
    shared: false,
    protected_release: false
  });
});

test("relay-only tests and operator entry points do not rerun product journeys", () => {
  for (const path of [
    "apps/relay/test/config/config.test.ts",
    "apps/relay/src/manage-account-restriction.ts",
    "apps/relay/src/observability.ts",
    "apps/relay/src/predeploy-check.ts"
  ]) {
    const result = classifyChanges([path]);
    assert.equal(result.javascript, true, `${path} must retain JavaScript checks`);
    assert.equal(result.ui_journey, false, `${path} must not select the UI journey`);
    assert.equal(result.native_journey, false, `${path} must not select the native journey`);
  }
});

test("native changes select native checks without an unrelated UI journey", () => {
  assert.deepEqual(classifyChanges(["apps/desktop/src-tauri/src/lib.rs"]), {
    documentation: true,
    workflow: false,
    javascript: false,
    native: true,
    ui_journey: false,
    native_journey: true,
    macos: true,
    cli: false,
    desktop: true,
    relay: false,
    shared: false,
    protected_release: false
  });
});

test("desktop frontend changes select UI coverage without native or packaged-app journeys", () => {
  for (const path of [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css",
    "apps/desktop/test/productSurfaces.test.tsx"
  ]) {
    const result = classifyChanges([path]);
    assert.equal(result.javascript, true, `${path} must select JavaScript checks`);
    assert.equal(result.ui_journey, true, `${path} must select UI journeys`);
    assert.equal(result.native_journey, false, `${path} must not select the native-shell journey`);
    assert.equal(result.macos, false, `${path} must not select packaged macOS coverage`);
  }
});

test("native and desktop manifest changes retain packaged-app coverage", () => {
  for (const path of [
    "apps/desktop/src-tauri/src/lib.rs",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/package.json",
    "package.json"
  ]) {
    const result = classifyChanges([path]);
    assert.equal(result.native_journey, true, `${path} must select the native-shell journey`);
    assert.equal(result.macos, true, `${path} must select packaged macOS coverage`);
  }
});

test("native IPC vocabulary changes exercise the native journey without rebuilding the packaged app", () => {
  const result = classifyChanges(["apps/desktop/native-command-error-codes.json"]);
  assert.equal(result.javascript, true);
  assert.equal(result.native_journey, true);
  assert.equal(result.macos, false);
});

test("protocol and lockfile changes use product journeys without rebuilding the packaged app", () => {
  for (const path of ["packages/protocol/src/relay-messages.ts", "package-lock.json", ".npmrc"]) {
    const result = classifyChanges([path]);
    assert.equal(result.ui_journey, true, `${path} must select the UI journey`);
    assert.equal(result.native_journey, true, `${path} must select the native-shell journey`);
    assert.equal(result.macos, false, `${path} must not select packaged macOS coverage`);
  }
});

test("macOS build configuration selects packaging without an unrelated native-shell journey", () => {
  const result = classifyChanges(["apps/desktop/vite.config.ts"]);
  assert.equal(result.javascript, true);
  assert.equal(result.ui_journey, true);
  assert.equal(result.native_journey, false);
  assert.equal(result.macos, true);
});

test("workflow changes select policy checks and manual runs can opt into all domains", () => {
  assert.deepEqual(classifyChanges([".github/workflows/supply-chain.yml"]), {
    documentation: false,
    workflow: true,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false,
    cli: false,
    desktop: false,
    relay: false,
    shared: false,
    protected_release: false
  });
  assert.deepEqual(allDomains(), {
    documentation: true,
    workflow: true,
    javascript: true,
    native: true,
    ui_journey: true,
    native_journey: true,
    macos: true,
    cli: true,
    desktop: true,
    relay: true,
    shared: true,
    protected_release: true
  });
});

test("documentation checks follow every maintained source of truth", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/reproducible-builds.md",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    "scripts/check-maintained-docs.mjs",
    "scripts/check-repository-content.mjs",
    "contracts/codex-app-server/support-policy.json",
    "apps/desktop/src-tauri/updater-public.key",
    "apps/desktop/src-tauri/src/lib.rs"
  ]) {
    assert.equal(classifyChanges([path]).documentation, true, `${path} must select documentation checks`);
  }
  const supportPolicy = classifyChanges(["contracts/codex-app-server/support-policy.json"]);
  assert.equal(supportPolicy.javascript, true);
  assert.equal(supportPolicy.native, true);
});

test("GitHub templates are documentation, while workflow code selects workflow checks", () => {
  const issueTemplate = classifyChanges([".github/ISSUE_TEMPLATE/bug_report.yml"]);
  assert.equal(issueTemplate.documentation, true);
  assert.equal(issueTemplate.workflow, false);
  assert.deepEqual(classifyChanges([".github/actions/setup-rust/README.md"]), {
    documentation: true,
    workflow: false,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false,
    cli: false,
    desktop: false,
    relay: false,
    shared: false,
    protected_release: false
  });
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

test("CLI-only changes select CLI checks without selecting desktop or release surfaces", () => {
  assert.deepEqual(classifyChanges(["apps/cli/src/main.rs", "apps/cli/Cargo.lock"]), {
    documentation: false,
    workflow: false,
    javascript: false,
    native: false,
    ui_journey: false,
    native_journey: false,
    macos: false,
    cli: true,
    desktop: false,
    relay: false,
    shared: false,
    protected_release: false
  });
});

test("shared protocol, MLS, contract, and crate paths select both client suites", () => {
  for (const path of [
    "packages/protocol/src/relay-messages.ts",
    "apps/desktop/src-tauri/crates/mls-core/src/lib.rs",
    "contracts/codex-app-server/support-policy.json",
    "crates/client-core/src/lib.rs"
  ]) {
    const result = classifyChanges([path]);
    assert.equal(result.shared, true, `${path} must be shared`);
    assert.equal(result.cli, true, `${path} must select CLI checks`);
    assert.equal(result.desktop, true, `${path} must select desktop checks`);
  }
});

test("protected desktop release paths are reported exactly", () => {
  const paths = [
    "apps/cli/src/main.rs",
    ".github/workflows/release.yml",
    "apps/desktop/src-tauri/Cargo.lock",
    "apps/desktop/src-tauri/Entitlements.plist",
    "docs/release-assets.v1.json",
    "tools/release/sync-release-metadata.mjs"
  ];
  assert.deepEqual(protectedReleasePaths(paths), paths.slice(1).sort());
  assert.equal(classifyChanges(paths).protected_release, true);
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const rootPackage = readJson("package.json");
const workspaceManifestPaths = [
  "apps/desktop/package.json",
  "apps/relay/package.json",
  "packages/codex/package.json",
  "packages/crypto/package.json",
  "packages/git/package.json",
  "packages/github/package.json",
  "packages/protocol/package.json"
];

test("release-facing version metadata stays synchronized", () => {
  for (const path of workspaceManifestPaths) {
    const manifest = readJson(path);
    assert.equal(manifest.version, rootPackage.version, `${path} version`);
    for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [name, version] of Object.entries(manifest[dependencyGroup] ?? {})) {
        if (name.startsWith("@multaiplayer/")) {
          assert.equal(version, rootPackage.version, `${path} ${dependencyGroup}.${name}`);
        }
      }
    }
  }

  const tauriConfig = readJson("apps/desktop/src-tauri/tauri.conf.json");
  assert.equal(tauriConfig.version, "../package.json", "Tauri must read the desktop package version directly");

  const cargoManifest = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  assert.equal(cargoManifest.match(/^version = "([^"]+)"$/m)?.[1], rootPackage.version, "Cargo package version");

  const cargoLock = readFileSync("apps/desktop/src-tauri/Cargo.lock", "utf8");
  const nativePackage = cargoLock.match(/\[\[package\]\]\nname = "multaiplayer"\nversion = "([^"]+)"/);
  assert.equal(nativePackage?.[1], rootPackage.version, "Cargo lockfile package version");

  const packageLock = readJson("package-lock.json");
  assert.equal(packageLock.version, rootPackage.version, "npm lockfile version");
  assert.equal(packageLock.packages[""].version, rootPackage.version, "npm root lockfile package version");
  for (const path of workspaceManifestPaths) {
    const workspacePath = path.replace(/\/package\.json$/, "");
    assert.equal(packageLock.packages[workspacePath].version, rootPackage.version, `${path} lockfile version`);
  }

  const codexRequests = readFileSync("packages/codex/src/json-rpc.ts", "utf8");
  assert.match(codexRequests, new RegExp(`version: "${rootPackage.version.replaceAll(".", "\\.")}"`));
});

test("CI verifies each layer once before packaging prebuilt desktop assets", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.equal(workflow.match(/run: npm run verify:web$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run verify:native$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run test:mutation -w @multaiplayer\/crypto$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run test:mutation -w @multaiplayer\/relay$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run test:mutation -w @multaiplayer\/protocol$/gm)?.length, 1);
  assert.match(workflow, /name: Build package dependencies\n\s+run: npm run build:packages/);
  assert.match(
    workflow,
    /crypto-mutation:\n\s+name: Crypto mutation policy\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 30/
  );
  assert.match(workflow, /relay-authorization-mutation:\n\s+name: Relay authorization mutation policy/);
  assert.match(workflow, /protocol-type-guard-mutation:\n\s+name: Protocol type-guard mutation policy/);
  assert.equal(workflow.match(/run: npm run build:packages && npm run build -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run tauri:build:prebuilt -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.doesNotMatch(workflow, /run: npm run (?:check|test|build)$/m);
});

test("relay authorization tests remain visible to the mutation runner", () => {
  const config = readFileSync("apps/relay/stryker.config.mjs", "utf8");
  const source = readFileSync("apps/relay/test/security-units.test.ts", "utf8");
  assert.match(config, /mutate: \["src\/authz\.ts"\]/);
  assert.match(config, /command: "tsx --test test\/security-units\.test\.ts"/);
  assert.match(source, /from "\.\.\/src\/authz\.js"/);
  assert.match(source, /createRelayAuthz\(/);
});

test("RustSec audit is pinned, scoped to the native lockfile, and scheduled", () => {
  const workflow = readFileSync(".github/workflows/rust-audit.yml", "utf8");
  assert.match(workflow, /working-directory: apps\/desktop\/src-tauri[\s\S]*run: cargo audit/);
  assert.match(workflow, /cargo deny --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml check advisories sources/);
  assert.match(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /checks: write/);
});

test("npm advisories are checked from the lockfile on changes and a schedule", () => {
  const workflow = readFileSync(".github/workflows/npm-audit.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run audit:npm/);
  assert.equal(rootPackage.scripts["audit:npm"], "npm audit --audit-level=high");
});

test("alpha dependencies are exact-pinned and major updates remain separately batched", () => {
  for (const path of ["package.json", ...workspaceManifestPaths]) {
    const manifest = readJson(path);
    for (const dependencyGroup of ["dependencies", "devDependencies"]) {
      for (const [name, version] of Object.entries(manifest[dependencyGroup] ?? {})) {
        if (name.startsWith("@multaiplayer/")) continue;
        assert.match(version, /^\d+\.\d+\.\d+(?:[-+].*)?$/, `${path} ${dependencyGroup}.${name}`);
      }
    }
  }

  const cargoManifest = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  const cargoDependencies = cargoManifest.slice(cargoManifest.indexOf("[build-dependencies]"));
  assert.doesNotMatch(cargoDependencies, /version\s*=\s*"(?!=)/);
  for (const requirement of cargoDependencies.matchAll(/^[-a-z0-9]+\s*=\s*"([^"]+)"$/gm)) {
    assert.match(requirement[1], /^=\d+\.\d+\.\d+$/, `Cargo dependency ${requirement[1]}`);
  }

  const dependabot = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(dependabot, /npm-major-update-batch:/);
  assert.match(dependabot, /cargo-major-update-batch:/);
  assert.equal(dependabot.match(/- major/g)?.length, 2);
  assert.match(dependabot, /github-actions-update-batch:/);
});

test("latest Codex contract drift is checked proactively with least privilege", () => {
  const workflow = readFileSync(".github/workflows/codex-latest-contract.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /@openai\/codex@latest/);
  assert.match(workflow, /check-latest-codex-runtime\.mjs/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /codex-app-server-contract-drift/);
  assert.match(workflow, /gh issue create/);
  assert.doesNotMatch(workflow, /contents: write/);
});

test("security boundaries have explicit automated review policy", () => {
  const contributing = readFileSync("CONTRIBUTING.md", "utf8");
  assert.match(contributing, /packages\/crypto/);
  assert.match(contributing, /property, fuzz, mutation, or native checks/);
  assert.match(contributing, /does not require a separate human or code-owner approval/);
});

test("crypto stays split into bounded modules behind its public barrel", () => {
  const sourceDirectory = "packages/crypto/src";
  const sourceFiles = readdirSync(sourceDirectory).filter((name) => name.endsWith(".ts"));
  for (const name of sourceFiles) {
    const source = readFileSync(`${sourceDirectory}/${name}`, "utf8");
    assert.ok(source.split("\n").length <= 250, `${name} exceeds the 250-line crypto module limit`);
  }
  const barrel = readFileSync(`${sourceDirectory}/index.ts`, "utf8");
  assert.doesNotMatch(barrel, /\b(?:async\s+)?function\b|\bclass\b|\bconst\b|\blet\b/);
});

test("third-party GitHub Actions are pinned to immutable commits", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/codex-latest-contract.yml",
    ".github/workflows/npm-audit.yml",
    ".github/workflows/release.yml",
    ".github/workflows/rust-audit.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/supply-chain.yml"
  ]) {
    const workflow = readFileSync(path, "utf8");
    const references = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?$/gm));
    assert.ok(references.length > 0, `${path} must use at least one action`);
    for (const [, reference, versionComment] of references) {
      if (reference.startsWith("./")) continue;
      assert.match(reference, /@[a-f0-9]{40}$/, `${path}: ${reference}`);
      assert.match(versionComment ?? "", /^v\d/, `${path}: ${reference} needs a readable version comment`);
    }
  }
});

test("desktop owns Monaco while the root enforces its DOMPurify security override", () => {
  const desktopPackage = readJson("apps/desktop/package.json");
  const packageLock = readJson("package-lock.json");

  assert.equal(rootPackage.devDependencies.dompurify, "3.4.12");
  assert.equal(rootPackage.overrides["monaco-editor"].dompurify, "$dompurify");
  assert.equal(rootPackage.devDependencies["monaco-editor"], undefined);
  assert.equal(desktopPackage.devDependencies["monaco-editor"], "0.55.1");
  assert.equal(packageLock.packages["node_modules/dompurify"].version, "3.4.12");
  assert.equal(packageLock.packages["apps/desktop"].devDependencies["monaco-editor"], "0.55.1");
});

test("TypeScript quality gates stay enforced", () => {
  assert.equal(rootPackage.scripts.lint, 'eslint eslint.config.mjs "{apps,packages,scripts,e2e}/**/*.{ts,tsx,mjs}"');
  assert.equal(
    rootPackage.scripts["format:check"],
    'prettier --check eslint.config.mjs "{apps,packages,scripts,e2e}/**/*.{ts,tsx,mjs}"'
  );
  assert.match(rootPackage.scripts["verify:web"], /^npm run lint && npm run format:check && /);
  assert.equal(rootPackage.devDependencies.eslint, "10.7.0");
  assert.equal(rootPackage.devDependencies.prettier, "3.9.5");
});

test("contributor architecture decisions stay indexed and structured", () => {
  for (const decision of [
    "zustand-store-boundaries.md",
    "active-host-authorization.md",
    "metadata-only-codex-activity.md"
  ]) {
    const record = readFileSync(`docs/decisions/${decision}`, "utf8");
    assert.match(record, /^Status: accepted$/m, decision);
    assert.match(record, /^## Decision$/m, decision);
    assert.match(record, /^## Consequences$/m, decision);
  }
});

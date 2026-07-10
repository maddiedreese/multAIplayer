import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  const codexClient = readFileSync("packages/codex/src/index.ts", "utf8");
  assert.match(codexClient, new RegExp(`version: "${rootPackage.version.replaceAll(".", "\\.")}"`));
});

test("CI verifies each layer once before packaging prebuilt desktop assets", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.equal(workflow.match(/run: npm run verify:web$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run verify:native$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run build:packages && npm run build -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run tauri:build:prebuilt -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.doesNotMatch(workflow, /run: npm run (?:check|test|build)$/m);
});

test("RustSec audit is pinned, scoped to the native lockfile, and scheduled", () => {
  const workflow = readFileSync(".github/workflows/rust-audit.yml", "utf8");
  assert.match(workflow, /uses: rustsec\/audit-check@v2\.0\.0/);
  assert.match(workflow, /working-directory: apps\/desktop\/src-tauri/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /checks: write/);
});

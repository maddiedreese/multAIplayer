import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const rootPackage = readJson("package.json");
const workspaceManifestPaths = [
  "apps/desktop/package.json",
  "apps/relay/package.json",
  "packages/codex/package.json",
  "packages/git/package.json",
  "packages/github/package.json",
  "packages/protocol/package.json"
];
const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((path) => path && existsSync(path));
const markdownFiles = trackedFiles.filter((path) => path.endsWith(".md"));

function withoutFencedCode(source) {
  return source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "");
}

test("tracked Markdown links resolve inside the repository", () => {
  const repositoryRoot = resolve(".");
  for (const sourcePath of markdownFiles) {
    const source = withoutFencedCode(readFileSync(sourcePath, "utf8"));
    for (const match of source.matchAll(/!?\[[^\]]*\]\((<?[^\s)>]+>?)(?:\s+[^)]*)?\)/g)) {
      const destination = match[1].replace(/^<|>$/g, "");
      if (
        destination.startsWith("#") ||
        destination.startsWith("//") ||
        /^[a-z][a-z\d+.-]*:/i.test(destination) ||
        /[{}]/.test(destination)
      ) {
        continue;
      }
      let localPath;
      try {
        localPath = decodeURIComponent(destination.split(/[?#]/, 1)[0]);
      } catch {
        assert.fail(`${sourcePath}: malformed local link ${destination}`);
      }
      const targetPath = resolve(dirname(resolve(sourcePath)), localPath);
      assert.ok(
        targetPath === repositoryRoot || targetPath.startsWith(`${repositoryRoot}/`),
        `${sourcePath}: local link escapes the repository: ${destination}`
      );
      assert.ok(existsSync(targetPath), `${sourcePath}: missing local link target ${destination}`);
    }
  }
});

test("documented npm scripts and project environment names exist", () => {
  const scriptNames = new Set(
    ["package.json", ...workspaceManifestPaths].flatMap((path) => Object.keys(readJson(path).scripts ?? {}))
  );
  const implementation = trackedFiles
    .filter((path) => !path.endsWith(".md"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const implementedEnvironmentNames = new Set(
    Array.from(implementation.matchAll(/\b(?:MULTAIPLAYER|GITHUB)_[A-Z0-9_]+\b/g), ([name]) => name)
  );

  for (const sourcePath of markdownFiles) {
    const source = readFileSync(sourcePath, "utf8");
    for (const [, scriptName] of source.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g)) {
      assert.ok(scriptNames.has(scriptName), `${sourcePath}: unknown npm script ${scriptName}`);
    }
    for (const [environmentName] of source.matchAll(/\b(?:MULTAIPLAYER|GITHUB)_[A-Z0-9_]+\b/g)) {
      assert.ok(
        implementedEnvironmentNames.has(environmentName),
        `${sourcePath}: no implementation references ${environmentName}`
      );
    }
  }
});

test("release-facing workspace versions stay synchronized", () => {
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
  const packageLock = readJson("package-lock.json");
  assert.equal(packageLock.version, rootPackage.version);
  assert.equal(packageLock.packages[""].version, rootPackage.version);
  assert.equal(readJson(".release-please-manifest.json")["."], rootPackage.version);
  assert.equal(readJson("apps/desktop/src-tauri/tauri.conf.json").version, "../package.json");
});

test("supported runtime and bundle settings are machine-readable policy", () => {
  assert.equal(rootPackage.engines?.node, ">=22");
  assert.equal(readFileSync(".nvmrc", "utf8").trim(), "22");
  assert.equal(readFileSync(".npmrc", "utf8").trim(), "engine-strict=true");
  const bundle = readJson("apps/desktop/src-tauri/tauri.conf.json").bundle;
  assert.deepEqual(bundle.targets, ["app", "dmg"]);
  assert.equal(bundle.macOS.signingIdentity, null);
  assert.equal(bundle.macOS.minimumSystemVersion, "11.0");
  assert.equal(readJson("railway.json").deploy?.sleepApplication, false);
});

test("dependency pins and security overrides remain explicit", () => {
  for (const path of ["package.json", ...workspaceManifestPaths]) {
    const manifest = readJson(path);
    for (const dependencyGroup of ["dependencies", "devDependencies"]) {
      for (const [name, version] of Object.entries(manifest[dependencyGroup] ?? {})) {
        if (!name.startsWith("@multaiplayer/")) {
          assert.match(version, /^\d+\.\d+\.\d+(?:[-+].*)?$/, `${path} ${dependencyGroup}.${name}`);
        }
      }
    }
  }
  const desktopPackage = readJson("apps/desktop/package.json");
  assert.equal(rootPackage.devDependencies.dompurify, "3.4.12");
  assert.equal(rootPackage.overrides["monaco-editor"].dompurify, "$dompurify");
  assert.equal(desktopPackage.devDependencies["monaco-editor"], "0.55.1");
});

test("Rust advisory exceptions have an owner, review date, and complete rationale", () => {
  const policy = readJson(".github/rust-advisory-policy.json");
  assert.equal(policy.version, 1);
  assert.ok(policy.owner.trim().length > 0);
  assert.match(policy.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Date.parse(`${policy.reviewBy}T23:59:59Z`) >= Date.now(), `policy expired on ${policy.reviewBy}`);
  for (const group of policy.advisoryGroups) {
    assert.ok(group.advisoryIds.length > 0);
    assert.ok(group.packages.length > 0);
    for (const field of ["dependencyPath", "platformScope", "reachability", "disposition"]) {
      assert.ok(group[field].trim().length > 0, `${group.name} needs ${field}`);
    }
  }
});

test("accepted architecture decisions keep their structured record", () => {
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

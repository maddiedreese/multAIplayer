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

function readJsonPathValue(value, jsonpath) {
  const segments = [];
  assert.ok(jsonpath.startsWith("$"), `release JSONPath must start at the document root: ${jsonpath}`);
  const matcher = /(?:\.([A-Za-z][A-Za-z0-9]*)|\['([^']*)'\])/g;
  let consumed = "$";
  for (const match of jsonpath.matchAll(matcher)) {
    consumed += match[0];
    segments.push(match[1] ?? match[2]);
  }
  assert.equal(consumed, jsonpath, `unsupported release JSONPath ${jsonpath}`);
  return segments.reduce((current, segment) => current?.[segment], value);
}

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

test("release automation declares every synchronized JSON target", () => {
  const extraFiles = readJson("release-please-config.json").packages?.["."]?.["extra-files"] ?? [];
  const targets = new Set(
    extraFiles
      .filter((entry) => typeof entry === "object" && entry.type === "json")
      .map((entry) => `${entry.path}\0${entry.jsonpath}`)
  );
  const requireTarget = (path, jsonpath) => {
    assert.ok(targets.has(`${path}\0${jsonpath}`), `release automation must update ${path} ${jsonpath}`);
    assert.equal(readJsonPathValue(readJson(path), jsonpath), rootPackage.version, `${path} ${jsonpath}`);
  };

  for (const path of workspaceManifestPaths) {
    requireTarget(path, "$.version");
    const manifest = readJson(path);
    for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dependencyName of Object.keys(manifest[dependencyGroup] ?? {}).filter((name) =>
        name.startsWith("@multaiplayer/")
      )) {
        requireTarget(path, `$['${dependencyGroup}']['${dependencyName}']`);
      }
    }
  }
  requireTarget("package-lock.json", "$.version");
  requireTarget("package-lock.json", "$['packages'][''].version");
  for (const manifestPath of workspaceManifestPaths) {
    requireTarget("package-lock.json", `$['packages']['${manifestPath.replace(/\/package\.json$/, "")}'].version`);
  }
  assert.ok(
    extraFiles.some(
      (entry) =>
        entry.type === "toml" &&
        entry.path === "apps/desktop/src-tauri/Cargo.toml" &&
        entry.jsonpath === "$.package.version"
    ),
    "release automation must update the native Cargo package version"
  );
  assert.ok(
    extraFiles.some(
      (entry) =>
        entry.type === "toml" &&
        entry.path === "apps/desktop/src-tauri/Cargo.lock" &&
        entry.jsonpath === "$.package[?(@.name=='multaiplayer')].version"
    ),
    "release automation must update the native Cargo lock package"
  );
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

test("third-party GitHub Actions use immutable commits with readable version comments", () => {
  const workflows = trackedFiles.filter((path) => path.startsWith(".github/workflows/") && path.endsWith(".yml"));
  for (const path of workflows) {
    const references = Array.from(readFileSync(path, "utf8").matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?$/gm));
    for (const [, reference, versionComment] of references) {
      if (reference.startsWith("./")) continue;
      assert.match(reference, /@[a-f0-9]{40}$/, `${path}: ${reference}`);
      assert.match(versionComment ?? "", /^v\d/, `${path}: ${reference} needs a readable version comment`);
    }
  }
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

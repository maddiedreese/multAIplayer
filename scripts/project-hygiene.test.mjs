import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
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
const trackedFiles = () =>
  execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((path) => path && existsSync(path));
const trackedMarkdownFiles = () => trackedFiles().filter((path) => path.endsWith(".md"));

const withoutFencedCode = (source) => source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "");

test("tracked Markdown links resolve to repository files", () => {
  const repositoryRoot = resolve(".");

  for (const sourcePath of trackedMarkdownFiles()) {
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

      const encodedPath = destination.split(/[?#]/, 1)[0];
      let localPath;
      try {
        localPath = decodeURIComponent(encodedPath);
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

test("documented npm scripts and project environment names stay implemented", () => {
  const scriptNames = new Set(
    ["package.json", ...workspaceManifestPaths].flatMap((path) => Object.keys(readJson(path).scripts ?? {}))
  );
  const implementation = trackedFiles()
    .filter((path) => !path.endsWith(".md"))
    .map((path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const implementedEnvironmentNames = new Set(
    Array.from(implementation.matchAll(/\b(?:MULTAIPLAYER|GITHUB)_[A-Z0-9_]+\b/g), ([name]) => name)
  );

  for (const sourcePath of trackedMarkdownFiles()) {
    const source = readFileSync(sourcePath, "utf8");
    for (const [, scriptName] of source.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g)) {
      assert.ok(scriptNames.has(scriptName), `${sourcePath}: unknown npm script ${scriptName}`);
    }
    for (const [environmentName] of source.matchAll(/\b(?:MULTAIPLAYER|GITHUB)_[A-Z0-9_]+\b/g)) {
      assert.ok(
        implementedEnvironmentNames.has(environmentName),
        `${sourcePath}: undocumented implementation for ${environmentName}`
      );
    }
  }
});

test("release operations remain consolidated in one living runbook", () => {
  assert.ok(existsSync("docs/release-operations.md"));
  for (const retiredPath of [
    "docs/alpha-release-readiness.md",
    "docs/official-relay-deployment-checklist.md",
    "docs/public-alpha-maintainer-guide.md",
    "docs/relay-migration-runbook.md",
    "docs/release-hardening.md"
  ]) {
    assert.ok(!existsSync(retiredPath), `${retiredPath} should stay consolidated`);
  }
});

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

test("local runtime and desktop bundle targets match supported CI", () => {
  assert.equal(rootPackage.engines?.node, ">=22", "the package contract must require the CI Node baseline");
  assert.equal(readFileSync(".nvmrc", "utf8").trim(), "22", ".nvmrc must select the CI Node major");
  assert.equal(
    readFileSync(".npmrc", "utf8").trim(),
    "engine-strict=true",
    "npm installs must reject unsupported Node runtimes"
  );

  const tauriConfig = readJson("apps/desktop/src-tauri/tauri.conf.json");
  assert.deepEqual(
    tauriConfig.bundle.targets,
    ["app", "dmg"],
    "the macOS-first alpha must not advertise unbuilt Windows or Linux bundles"
  );

  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  for (const [name, source] of [
    ["CI", workflow],
    ["release", release]
  ]) {
    assert.match(source, /node-version: 22/, `${name} must use the documented Node baseline`);
    assert.match(source, /runs-on: macos-15/, `${name} must build the supported desktop platform`);
    assert.match(source, /bundle\/macos\/multAIplayer\.app/, `${name} must handle the configured app bundle`);
    assert.match(source, /bundle\/dmg/, `${name} must handle the configured DMG bundle`);
  }
});

test("CI verifies each layer once before packaging prebuilt desktop assets", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const packagePath of [
    "packages/crypto/package.json",
    "apps/relay/package.json",
    "packages/protocol/package.json"
  ]) {
    const scripts = readJson(packagePath).scripts;
    assert.equal(
      scripts["test:mutation"],
      "npm run test:mutation:run && npm run test:mutation:summary && npm run test:mutation:policy",
      `${packagePath} must enforce the repository policy after producing its mutation report`
    );
  }
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

test("Rust mutation exclusions and their CI gate stay narrowly pinned", () => {
  const config = readFileSync("apps/desktop/src-tauri/.cargo/mutants.toml", "utf8");
  const exclusions = Array.from(config.matchAll(/^\s*"([^"]+)",$/gm), ([, value]) => value);
  assert.deepEqual(exclusions, [
    "authorize_shell_execution",
    "clear_shell_execution_grants",
    "authorize_terminal_input",
    "replace > with >= in ShellAuthorizationState::issue",
    "replace > with >= in ShellAuthorizationState::issue_terminal_input",
    "replace > with >= in ShellAuthorizationState::has_exact_command_grant",
    "replace > with >= in ShellAuthorizationState::grant_exact_command"
  ]);

  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /rust-shell-boundary-mutation:\n\s+name: Rust shell boundary mutation policy/);
  assert.match(workflow, /cargo install cargo-mutants --version 27\.1\.0 --locked/);
  assert.match(
    workflow,
    /cargo mutants[\s\S]*--file src\/shell_authorization\.rs[\s\S]*--file src\/command_safety\.rs[\s\S]*--timeout 120/
  );
});

test("production Rust panic policy has no unwrap or expect exceptions", () => {
  const crateRoot = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
  assert.match(crateRoot, /#!\[cfg_attr\(not\(test\), deny\(clippy::expect_used, clippy::unwrap_used\)\)\]/);

  const rustSources = execFileSync("git", ["ls-files", "apps/desktop/src-tauri/src"], {
    encoding: "utf8"
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((path) => path.endsWith(".rs"))
    .filter((path) => !path.endsWith("/tests.rs") && !path.endsWith("/lib_tests.rs"));
  const exceptions = rustSources.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return Array.from(source.matchAll(/#\[allow\(clippy::expect_used\)\]\s*fn\s+(\w+)/g), ([, name]) => [path, name]);
  });
  assert.deepEqual(exceptions, []);
});

test("relay reproducibility proof stays deterministic and release-triggered", () => {
  const dockerfile = readFileSync("apps/relay/Dockerfile", "utf8");
  const verifier = readFileSync("scripts/verify-relay-container-reproducibility.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/supply-chain.yml", "utf8");
  assert.match(dockerfile, /ARG NODE_IMAGE=.*@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS build/);
  assert.match(dockerfile, /ARG SOURCE_DATE_EPOCH=0/);
  assert.equal(verifier.match(/"--no-cache"/g)?.length, 1);
  assert.match(verifier, /assert\.deepEqual\(second, first/);
  assert.match(workflow, /release:\n\s+types: \[published\]/);
  assert.match(workflow, /run: node scripts\/verify-relay-container-reproducibility\.mjs/);
});

test("release SBOM, provenance, and keyless signatures remain gated", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const documentation = readFileSync("docs/release-operations.md", "utf8");
  assert.match(workflow, /name: Generate SPDX SBOM[\s\S]*anchore\/sbom-action@[a-f0-9]{40}/);
  assert.match(workflow, /artifact-name: multaiplayer\.spdx\.json/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}[\s\S]*subject-path: release-assets\/\*/);
  assert.match(workflow, /sigstore\/cosign-installer@[a-f0-9]{40}/);
  assert.match(workflow, /cosign sign-blob --yes --bundle release-assets\/SHA256SUMS\.txt\.sigstore\.json/);
  assert.match(workflow, /cosign sign-blob --yes --bundle release-assets\/multaiplayer\.spdx\.json\.sigstore\.json/);
  assert.match(workflow, /gh release create[\s\S]*release-assets\/\*/);
  assert.match(documentation, /SPDX SBOM/);
  assert.match(documentation, /build-provenance/i);
  assert.match(documentation, /Sigstore/i);
});

test("relay operational messages use the structured observability sink", () => {
  const config = readFileSync("apps/relay/src/config.ts", "utf8");
  const observability = readFileSync("apps/relay/src/observability.ts", "utf8");
  const relaySources = relaySourceFiles("apps/relay/src");
  for (const path of relaySources) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /console\.(?:log|warn|error)/,
      `${path} bypasses structured logging`
    );
  }
  assert.match(config, /logRelayEvent\("warn", "invalid_storage_backend_ignored"\)/);
  assert.match(config, /logRelayEvent\("warn", "invalid_allowed_origin_ignored"\)/);
  assert.match(config, /logRelayEvent\("warn", "weak_session_secret_disables_persistence"/);
  assert.match(observability, /service: "multaiplayer-relay"/);
  assert.match(observability, /defaultRelayLogSink/);
});

function relaySourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return relaySourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("RustSec audit is pinned, scoped to the native lockfile, and scheduled", () => {
  const workflow = readFileSync(".github/workflows/rust-audit.yml", "utf8");
  assert.match(workflow, /working-directory: apps\/desktop\/src-tauri[\s\S]*run: cargo audit/);
  assert.match(workflow, /cargo deny --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml check advisories sources/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /release:\n\s+types: \[published\]/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /checks: write/);
});

test("npm advisories are checked from the lockfile on the deep-verification tier", () => {
  const workflow = readFileSync(".github/workflows/npm-audit.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /release:\n\s+types: \[published\]/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run audit:npm/);
  assert.equal(rootPackage.scripts["audit:npm"], "npm audit --audit-level=high");
});

test("the independent crypto verifier is exact-pinned with an expiring review gate", () => {
  const policy = readJson(".github/crypto-vector-dependency.json");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.equal(policy.package, "cryptography");
  assert.equal(policy.version, "45.0.5");
  assert.equal(policy.maximumReviewDays, 90);
  assert.match(workflow, /run: npm run check:crypto-vector-dependency/);
  assert.match(workflow, /cryptography==45\.0\.5/);
  assert.equal(
    rootPackage.scripts["check:crypto-vector-dependency"],
    "node scripts/check-crypto-vector-dependency.mjs"
  );
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

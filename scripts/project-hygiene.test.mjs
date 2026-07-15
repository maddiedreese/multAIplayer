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

const withoutFencedCode = (source) => source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "");

test("backup restore drill validates the complete current relay schema", () => {
  const schema = readFileSync("apps/relay/src/sqlite-schema.ts", "utf8");
  const drill = readFileSync("scripts/sqlite-backup-restore-drill.mjs", "utf8");
  const schemaTables = Array.from(schema.matchAll(/create table if not exists (relay_[a-z_]+)/g), ([, name]) => name);
  const requiredBlock = drill.match(/const requiredRelayTables = \[([\s\S]*?)\n\];/)?.[1] ?? "";
  const drillTables = Array.from(requiredBlock.matchAll(/"(relay_[a-z_]+)"/g), ([, name]) => name);

  assert.deepEqual(drillTables, schemaTables);
});

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

test("public entry points stay native-only, release-accurate, and backed by current UI captures", () => {
  const readme = readFileSync("README.md", "utf8");
  const captureScript = readFileSync("scripts/capture-readme-screens.mjs", "utf8");
  const harnessMain = readFileSync("e2e/harness/main.tsx", "utf8");
  const harnessStyles = readFileSync("e2e/harness/styles.css", "utf8");
  const currentGuides = [
    "README.md",
    "CONTRIBUTING.md",
    ...trackedMarkdownFiles().filter(
      (path) =>
        path.startsWith("docs/") && path !== "docs/threat-model-changelog.md" && !path.startsWith("docs/decisions/")
    )
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.match(readme, /apps\/desktop\/src\/assets\/multaiplayer-icon\.png/);
  for (const image of ["onboarding.png", "safe-defaults.png", "codex-room.png"]) {
    assert.ok(existsSync(`docs/assets/screens/${image}`), `missing README UI capture ${image}`);
    assert.match(readme, new RegExp(`docs/assets/screens/${image.replace(".", "\\.")}`));
  }
  assert.equal(rootPackage.scripts["docs:screenshots"], "node scripts/capture-readme-screens.mjs");
  assert.match(captureScript, /capture\(page, "onboarding"/);
  assert.match(captureScript, /scenarioUrl\("codex-chat-parity"\)/);
  assert.match(captureScript, /page\.locator\("\.readme-feature"\)/);
  assert.match(captureScript, /scrollHeight !== dimensions\.clientHeight/);
  assert.match(captureScript, /reducedMotion: "reduce"/);
  assert.match(harnessMain, /document\.documentElement\.dataset\.theme = "dark"/);
  assert.match(harnessStyles, /\.readme-feature \{/);
  assert.match(harnessStyles, /padding: 28px/);
  assert.match(readme, /Build with Codex\. Together\./);
  assert.match(readme, /Multiplayer Codex for trusted teams/);
  assert.doesNotMatch(readme, /deterministic captures|representative local data|not concept art/i);
  assert.match(currentGuides, /official free-alpha relay is live on Railway/i);
  assert.match(currentGuides, /read:user repo/);
  assert.doesNotMatch(
    currentGuides,
    /planned for Railway|not currently live|seeded browser demo|seeded-room mode|placeholder download|existing scaffold download/i
  );
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

test("the hosted relay stays warm instead of scaling to zero", () => {
  const railwayConfig = readJson("railway.json");
  assert.equal(
    railwayConfig.deploy?.sleepApplication,
    false,
    "Railway Serverless sleeping would add a cold start to the first relay request"
  );
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
  assert.equal(
    tauriConfig.bundle.macOS.signingIdentity,
    null,
    "ordinary local builds must not silently select a signing identity"
  );
  assert.equal(
    tauriConfig.bundle.macOS.minimumSystemVersion,
    "11.0",
    "the Apple silicon package must declare its supported macOS floor"
  );

  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  const deploymentTargetCheck = readFileSync("scripts/verify-macos-deployment-target.sh", "utf8");
  assert.match(
    deploymentTargetCheck,
    /lipo "\$candidate" -verify_arch arm64/,
    "every bundled Mach-O file must be checked for Apple silicon support"
  );
  assert.match(
    workflow,
    /Build ad-hoc signed Tauri app[\s\S]{0,160}APPLE_SIGNING_IDENTITY: "-"[\s\S]{0,160}tauri:build:release/,
    "macOS CI must explicitly ad-hoc sign the inspection bundle before verifying entitlements"
  );
  for (const [name, source] of [
    ["CI", workflow],
    ["release", release]
  ]) {
    assert.match(source, /node-version: 22/, `${name} must use the documented Node baseline`);
    assert.match(source, /runs-on: macos-15/, `${name} must build the supported desktop platform`);
    assert.match(source, /aarch64-apple-darwin/, `${name} must build the Apple silicon target`);
    assert.match(source, /lipo -archs/, `${name} must verify the packaged executable architecture`);
    assert.match(source, /LSMinimumSystemVersion/, `${name} must verify the packaged macOS floor`);
    assert.match(source, /MACOSX_DEPLOYMENT_TARGET: "11\.0"/, `${name} must compile for the documented macOS floor`);
    assert.match(
      source,
      /verify-macos-deployment-target\.sh/,
      `${name} must inspect Mach-O build-version load commands`
    );
    assert.match(
      source,
      /(?:bundle\/macos\/multAIplayer\.app|\$bundle_root\/macos\/multAIplayer\.app)/,
      `${name} must handle the configured app bundle`
    );
    assert.match(source, /(?:bundle\/dmg|\$bundle_root\/dmg)/, `${name} must handle the configured DMG bundle`);
  }
});

test("the UI-contract E2E harness cannot enter the production desktop bundle", () => {
  for (const path of [
    "e2e/harness/main.tsx",
    "e2e/invite-join.spec.ts",
    "e2e/host-handoff.spec.ts",
    "e2e/codex-turn-approval.spec.ts",
    "e2e/web-shell.spec.ts"
  ]) {
    assert.ok(existsSync(path), `${path} must remain part of the blocking browser journey suite`);
  }
  const playwrightConfig = readFileSync("e2e/playwright.config.ts", "utf8");
  assert.match(
    playwrightConfig,
    /command: "vite --config e2e\/harness\/vite\.config\.ts",\s+cwd: "\.\."/,
    "the harness server must run from the repository root"
  );
  assert.doesNotMatch(
    readFileSync("apps/desktop/vite.config.ts", "utf8"),
    /e2e\/harness|UiContractScenario/,
    "the production Vite graph must not reference the test harness"
  );
  for (const path of trackedFiles().filter((candidate) => candidate.startsWith("apps/desktop/src/"))) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /e2e\/harness|UiContractScenario/,
      `${path} must not import or activate the test harness`
    );
  }
});

test("native WebView drivers stay exactly pinned and outside production registration", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
  const cargoManifest = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  const nativeLibrary = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
  const mlsNative = readFileSync("apps/desktop/src-tauri/src/mls_native.rs", "utf8");
  const desktopEntry = readFileSync("apps/desktop/src/main.tsx", "utf8");
  const nativeE2eConfig = readFileSync("apps/desktop/src-tauri/tauri.native-e2e.conf.json", "utf8");

  assert.match(workflow, /cargo install tauri-driver --version 2\.0\.6 --locked/);
  assert.equal(rootPackage.devDependencies["@wdio/tauri-service"], "1.2.0");
  assert.equal(rootPackage.devDependencies["@wdio/tauri-plugin"], "1.2.0");
  assert.equal(rootPackage.overrides["@wdio/native-utils"], "2.5.0");
  assert.match(cargoManifest, /native-e2e = \["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"\]/);
  assert.match(cargoManifest, /tauri-plugin-wdio = \{ version = "=1\.2\.0", optional = true \}/);
  assert.match(cargoManifest, /tauri-plugin-wdio-webdriver = \{ version = "=1\.2\.0", optional = true \}/);
  assert.match(nativeLibrary, /#\[cfg\(feature = "native-e2e"\)\]/);
  assert.match(mlsNative, /com\.multaiplayer\.desktop\.native-e2e\.room-secrets/);
  assert.match(desktopEntry, /import\.meta\.env\.VITE_NATIVE_E2E === "true"/);
  assert.match(nativeE2eConfig, /"wdio:default"/);
  assert.match(nativeE2eConfig, /"wdio-webdriver:default"/);
  assert.match(workflow, /VITE_NATIVE_E2E: "true"/);
  assert.match(workflow, /npm run test:e2e:native:macos-smoke/);
  assert.match(workflow, /name: macos-wkwebview-smoke/);
  assert.match(workflow, /Rebuild the production frontend without the test driver/);
  assert.doesNotMatch(releaseWorkflow, /native-e2e|wdio/i);
});

test("CI verifies each layer once before packaging prebuilt desktop assets", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const packagePath of ["apps/relay/package.json", "packages/protocol/package.json"]) {
    const scripts = readJson(packagePath).scripts;
    assert.equal(
      scripts["test:mutation"],
      "npm run test:mutation:run && npm run test:mutation:summary && npm run test:mutation:policy",
      `${packagePath} must enforce the repository policy after producing its mutation report`
    );
  }
  assert.equal(workflow.match(/run: npm run verify:web$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run verify:native$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run test:mutation -w @multaiplayer\/relay$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run test:mutation -w @multaiplayer\/protocol$/gm)?.length, 1);
  assert.match(workflow, /name: Build package dependencies\n\s+run: npm run build:packages/);
  assert.match(workflow, /relay-authorization-mutation:\n\s+name: Relay authorization mutation policy/);
  assert.match(workflow, /protocol-type-guard-mutation:\n\s+name: Protocol type-guard mutation policy/);
  assert.equal(workflow.match(/run: npm run build -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.equal(workflow.match(/run: npm run tauri:build:release -w @multaiplayer\/desktop$/gm)?.length, 1);
  assert.doesNotMatch(workflow, /run: npm run (?:check|test|build)$/m);
});

test("CI retains native journey timing and honest cross-platform composition evidence", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    workflow,
    /name: Run two real native clients through invite, message, and handoff[\s\S]*name: Enforce native journey duration policy\n\s+if: steps\.native-policy\.outputs\.run == 'true'\n\s+run: node scripts\/check-native-journey-duration\.mjs reports\/native-shell-e2e\/duration\.json[\s\S]*name: Upload native journey duration metrics/
  );
  assert.match(workflow, /name: Real two-client native MLS journey[\s\S]*name: Classify native journey applicability/);
  assert.match(workflow, /node scripts\/native-journey-change-policy\.mjs --changed-files/);
  assert.match(workflow, /name: Upload native journey duration metrics[\s\S]*name: native-shell-journey-metrics/);
  assert.match(
    workflow,
    /name: native-shell-journey-metrics[\s\S]*path: reports\/native-shell-e2e\/duration\.json[\s\S]*if-no-files-found: error[\s\S]*retention-days: 30/
  );
  assert.equal(
    workflow.match(/run: npx tsx --test apps\/relay\/test\/live-native-relay-journey\.test\.ts$/gm)?.length,
    1,
    "the macOS package lane must run the real native-core/relay composition exactly once"
  );
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
  const roots = ["apps/desktop/src-tauri/src", "apps/desktop/src-tauri/crates/mls-core/src"];
  for (const path of roots.map((root) => `${root}/lib.rs`)) {
    const crateRoot = readFileSync(path, "utf8");
    assert.match(crateRoot, /#!\[cfg_attr\(not\(test\), deny\(clippy::expect_used, clippy::unwrap_used\)\)\]/);
  }

  const collectRustSources = (root) =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = `${root}/${entry.name}`;
      return entry.isDirectory() ? collectRustSources(path) : path.endsWith(".rs") ? [path] : [];
    });
  const rustSources = roots
    .flatMap(collectRustSources)
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
  assert.match(dockerfile, /ARG RUST_IMAGE=.*@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /MULTAIPLAYER_MLS_VALIDATOR_PATH=\/app\/bin\/mls-keypackage-validator/);
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
  assert.match(workflow, /gh release view[\s\S]*gh release upload[\s\S]*gh release create[\s\S]*release-assets\/\*/);
  assert.match(documentation, /SPDX SBOM/);
  assert.match(documentation, /build-provenance/i);
  assert.match(documentation, /Sigstore/i);
});

test("release automation preserves alpha, CI, and DCO gates", () => {
  const workflow = readFileSync(".github/workflows/release-please.yml", "utf8");
  const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
  const manifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
  assert.match(workflow, /googleapis\/release-please-action@[a-f0-9]{40}/);
  assert.match(workflow, /secrets\.RELEASE_PLEASE_TOKEN/);
  assert.equal(config.prerelease, true);
  assert.equal(config.packages["."]["prerelease-type"], "alpha");
  assert.match(config.signoff, /github-actions\[bot\].+@users\.noreply\.github\.com/);
  assert.equal(manifest["."], rootPackage.version);
});

test("release automation covers every synchronized version source", () => {
  const config = readJson("release-please-config.json");
  const extraFiles = config.packages?.["."]?.["extra-files"] ?? [];
  const configuredTargets = new Set(
    extraFiles
      .filter((entry) => typeof entry === "object" && entry.type === "json")
      .map((entry) => `${entry.path}\0${entry.jsonpath}`)
  );
  const requireJsonTarget = (path, jsonpath) => {
    assert.ok(configuredTargets.has(`${path}\0${jsonpath}`), `release automation must update ${path} ${jsonpath}`);
    assert.equal(readJsonPathValue(readJson(path), jsonpath), rootPackage.version, `${path} ${jsonpath}`);
  };

  for (const path of workspaceManifestPaths) {
    requireJsonTarget(path, "$.version");
    const manifest = readJson(path);
    for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dependencyName of Object.keys(manifest[dependencyGroup] ?? {}).filter((name) =>
        name.startsWith("@multaiplayer/")
      )) {
        requireJsonTarget(path, `$['${dependencyGroup}']['${dependencyName}']`);
      }
    }
  }

  requireJsonTarget("package-lock.json", "$.version");
  requireJsonTarget("package-lock.json", "$['packages'][''].version");
  const packageLock = readJson("package-lock.json");
  for (const manifestPath of workspaceManifestPaths) {
    const workspacePath = manifestPath.replace(/\/package\.json$/, "");
    requireJsonTarget("package-lock.json", `$['packages']['${workspacePath}'].version`);
    const lockedPackage = packageLock.packages[workspacePath];
    for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dependencyName of Object.keys(lockedPackage[dependencyGroup] ?? {}).filter((name) =>
        name.startsWith("@multaiplayer/")
      )) {
        requireJsonTarget(
          "package-lock.json",
          `$['packages']['${workspacePath}']['${dependencyGroup}']['${dependencyName}']`
        );
      }
    }
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
  assert.match(
    readFileSync("apps/desktop/src-tauri/Cargo.lock", "utf8"),
    new RegExp(`name = "multaiplayer"\\nversion = "${rootPackage.version.replaceAll(".", "\\.")}"`),
    "Cargo.lock must contain the synchronized native package version"
  );
  const workflow = readFileSync(".github/workflows/release-please.yml", "utf8");
  assert.match(workflow, /npm install --package-lock-only --ignore-scripts/);
  assert.match(workflow, /node scripts\/sync-release-metadata\.mjs/);
  assert.match(workflow, /git commit --signoff/);
  assert.ok(
    extraFiles.some((entry) => entry.type === "generic" && entry.path === "packages/codex/src/json-rpc.ts"),
    "release automation must include packages/codex/src/json-rpc.ts"
  );
  assert.match(
    readFileSync("packages/codex/src/json-rpc.ts", "utf8"),
    /x-release-please-version/,
    "packages/codex/src/json-rpc.ts needs a version annotation"
  );
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

test("RustSec audit is pinned, covers every native lockfile, and is scheduled", () => {
  const workflow = readFileSync(".github/workflows/rust-audit.yml", "utf8");
  assert.match(workflow, /working-directory: apps\/desktop\/src-tauri[\s\S]*run: \|\n\s+cargo audit/);
  assert.match(workflow, /cargo audit --file crates\/mls-core\/fuzz\/Cargo\.lock/);
  assert.match(workflow, /cargo deny --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml check advisories sources/);
  assert.match(
    workflow,
    /cargo deny --manifest-path apps\/desktop\/src-tauri\/crates\/mls-core\/fuzz\/Cargo\.toml check advisories sources/
  );
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /release:\n\s+types: \[published\]/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /checks: write/);
});

test("Rust advisory exceptions have complete ownership and an unexpired review date", () => {
  const policy = readJson(".github/rust-advisory-policy.json");
  assert.equal(policy.version, 1);
  assert.ok(policy.owner.trim().length > 0);
  assert.match(policy.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(
    Date.parse(`${policy.reviewBy}T23:59:59Z`) >= Date.now(),
    `Rust advisory policy review expired on ${policy.reviewBy}`
  );

  const groups = policy.advisoryGroups;
  assert.ok(Array.isArray(groups) && groups.length > 0);
  for (const group of groups) {
    assert.ok(group.name.trim().length > 0);
    assert.ok(group.advisoryIds.length > 0);
    assert.ok(group.packages.length > 0);
    for (const field of ["dependencyPath", "platformScope", "reachability", "disposition"]) {
      assert.ok(group[field].trim().length > 0, `${group.name} needs ${field}`);
    }
  }

  const trackedIds = new Set(groups.flatMap((group) => group.advisoryIds));
  const requiredIds = new Set([
    "RUSTSEC-2024-0370",
    "RUSTSEC-2024-0411",
    "RUSTSEC-2024-0412",
    "RUSTSEC-2024-0413",
    "RUSTSEC-2024-0414",
    "RUSTSEC-2024-0415",
    "RUSTSEC-2024-0416",
    "RUSTSEC-2024-0417",
    "RUSTSEC-2024-0418",
    "RUSTSEC-2024-0419",
    "RUSTSEC-2024-0420",
    "RUSTSEC-2024-0429",
    "RUSTSEC-2025-0075",
    "RUSTSEC-2025-0080",
    "RUSTSEC-2025-0081",
    "RUSTSEC-2025-0098",
    "RUSTSEC-2025-0100"
  ]);
  assert.deepEqual([...trackedIds].sort(), [...requiredIds].sort(), "all inherited advisories must stay tracked");
  const denySource = readFileSync("deny.toml", "utf8");
  const ignoredIds = new Set(Array.from(denySource.matchAll(/"(RUSTSEC-\d{4}-\d{4})"/g), ([, id]) => id));
  assert.deepEqual(
    [...ignoredIds].sort(),
    [...trackedIds].filter((id) => id !== "RUSTSEC-2024-0429").sort(),
    "the structured ledger must exactly cover cargo-deny's advisory exceptions"
  );
});

test("production Rust source files stay within the external-review line budget", () => {
  const rustSources = trackedFiles().filter(
    (path) =>
      path.startsWith("apps/desktop/src-tauri/") &&
      path.includes("/src/") &&
      path.endsWith(".rs") &&
      !path.includes("/fuzz/") &&
      !path.endsWith("/tests.rs") &&
      !path.endsWith("/lib_tests.rs")
  );
  for (const path of rustSources) {
    const source = readFileSync(path, "utf8");
    const physicalLines = source.length === 0 ? 0 : source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
    assert.ok(physicalLines <= 1000, `${path} has ${physicalLines} physical lines; maximum is 1000`);
  }
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
  assert.match(contributing, /Rust MLS core/);
  assert.match(contributing, /property, fuzz, mutation, or native checks/);
  assert.match(contributing, /does not require a separate human or code-owner approval/);
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
  assert.equal(
    rootPackage.scripts.lint,
    'eslint eslint.config.mjs "{apps,packages,scripts,e2e,tools}/**/*.{ts,tsx,mjs}"'
  );
  assert.equal(
    rootPackage.scripts["format:check"],
    'prettier --check eslint.config.mjs "{apps,packages,scripts,e2e,tools}/**/*.{ts,tsx,mjs}"'
  );
  assert.equal(readJson("tsconfig.base.json").compilerOptions.noUncheckedIndexedAccess, true);
  assert.match(rootPackage.scripts["verify:web"], /^npm run lint && npm run format:check && /);
  assert.equal(rootPackage.devDependencies.eslint, "10.7.0");
  assert.equal(rootPackage.devDependencies.prettier, "3.9.5");
});

test("accessibility automation gates the main UI contract surfaces", () => {
  const helper = readFileSync("e2e/helpers.ts", "utf8");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const requiredScenarios = ["e2e/codex-chat-parity.spec.ts", "e2e/onboarding.spec.ts", "e2e/invite-join.spec.ts"];

  assert.equal(rootPackage.devDependencies["@axe-core/playwright"], "4.12.1");
  assert.match(helper, /new AxeBuilder\(\{ page \}\)/);
  for (const tag of ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]) {
    assert.match(helper, new RegExp(`["]${tag}["]`), `axe helper must retain ${tag}`);
  }
  assert.match(helper, /\.analyze\(\)/);
  for (const scenario of requiredScenarios) {
    assert.match(
      readFileSync(scenario, "utf8"),
      /await expectNoAxeViolations\(page\)/,
      `${scenario} must execute the shared axe assertion`
    );
  }
  assert.match(workflow, /web-shell-e2e:[\s\S]*run: npm run test:e2e/);
});

test("the staged exact optional-property migration has an owner and removal trigger", () => {
  const inventory = readFileSync("docs/compatibility-inventory.md", "utf8");
  const policy = inventory.match(/`exactOptionalPropertyTypes` remains staged[\s\S]*?(?=\n## |\n$)/)?.[0];

  assert.ok(policy, "compatibility inventory must retain the staged exactOptionalPropertyTypes policy");
  assert.match(policy, /maintainer owns the migration/);
  assert.match(policy, /before protocol\/store schema v2 or the first stable release, whichever comes first/);
  assert.match(policy, /define omitted, explicit `null`, and `undefined` semantics/);
  assert.match(policy, /enabling the flag/);
  assert.match(policy, /paragraph is removed when that gate lands/);
});

test("scheduled native fuzzing restores and saves a growing corpus", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const start = workflow.indexOf("\n  mls-deserialization-fuzz:");
  const end = workflow.indexOf("\n  mls-validator-benchmark:", start);
  assert.ok(start >= 0 && end > start, "native fuzz job must remain present");
  const job = workflow.slice(start, end);

  assert.match(job, /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(job, /uses: actions\/cache@[a-f0-9]{40}/);
  assert.match(job, /path: apps\/desktop\/src-tauri\/crates\/mls-core\/fuzz\/corpus/);
  assert.match(job, /key: native-fuzz-corpus-[^\n]*\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(job, /restore-keys:[\s\S]*native-fuzz-corpus-[^\n]*\$\{\{ hashFiles\([^\n]+\) \}\}-/);
  assert.match(job, /fuzz run key_package_deserialization -- -max_total_time=120/);
  assert.match(job, /fuzz run codex_app_server_projection -- -max_total_time=120/);
  assert.ok(
    existsSync(
      "apps/desktop/src-tauri/crates/mls-core/fuzz/corpus/key_package_deserialization/invalid-key-package-upload.json"
    )
  );
  assert.ok(
    existsSync("apps/desktop/src-tauri/crates/mls-core/fuzz/corpus/codex_app_server_projection/command-completed.json")
  );
});

test("relay HTTP handlers use the structured error taxonomy", () => {
  const handlerFiles = ["apps/relay/src/auth", "apps/relay/src/http"].flatMap((directory) =>
    readdirSync(directory, { recursive: true })
      .filter((path) => typeof path === "string" && path.endsWith(".ts"))
      .map((path) => `${directory}/${path}`)
  );
  for (const path of handlerFiles) {
    if (path.endsWith("/errors.ts") || path.endsWith("/upstream.ts")) continue;
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /\.status\([^)]*\)\s*\.json\(\s*\{\s*error\s*:/,
      `${path} must call sendRelayError for error responses`
    );
  }
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

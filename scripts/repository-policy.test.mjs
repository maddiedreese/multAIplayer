import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";

function rustDenyExceptionIdentity(entry) {
  if (typeof entry === "string") {
    assert.match(entry, /^RUSTSEC-\d{4}-\d{4}$/, `Unsupported Rust deny exception identity: ${entry}`);
    return entry;
  }
  assert.ok(
    entry && typeof entry === "object" && !Array.isArray(entry),
    "Rust deny exceptions must be strings or tables"
  );
  const identityKey = Object.hasOwn(entry, "id") ? "id" : Object.hasOwn(entry, "crate") ? "crate" : undefined;
  assert.ok(identityKey, "Rust deny exception tables must contain id or crate");
  assert.deepEqual(Object.keys(entry).sort(), [identityKey, "reason"].sort());
  assert.equal(typeof entry.reason, "string");
  assert.ok(entry.reason.trim().length > 0, "Rust deny exception reasons must not be empty");
  if (identityKey === "id") {
    assert.match(entry.id, /^RUSTSEC-\d{4}-\d{4}$/);
    return entry.id;
  }
  assert.match(entry.crate, /^[a-zA-Z0-9_-]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  return `crate:${entry.crate}`;
}

test("PR title policy accepts release-history titles", () => {
  assert.equal(
    spawnSync(process.execPath, ["scripts/check-pr-title.mjs", "fix(relay): preserve runtime packages"]).status,
    0
  );
  assert.notEqual(spawnSync(process.execPath, ["scripts/check-pr-title.mjs", "Preserve runtime packages"]).status, 0);
});

test("PR title validation reruns when the squash title is edited", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pull_request:\s+types: \[[^\]]*edited[^\]]*\]/);
});

test("Gitleaks exceptions are exact secret fixtures, not path or commit exclusions", () => {
  const config = readFileSync(".gitleaks.toml", "utf8");
  assert.match(config, /regexTarget = "secret"/);
  assert.doesNotMatch(config, /^\s*(paths|commits|stopwords)\s*=/m);
  assert.doesNotMatch(config, /\[\[rules\]\]/);
});

test("Rust advisory exceptions have an unexpired owner-reviewed policy that matches deny.toml", () => {
  const policy = JSON.parse(readFileSync(".github/rust-advisory-policy.json", "utf8"));
  const deny = readFileSync("deny.toml", "utf8");
  const parsedDeny = parseToml(deny);
  assert.ok(Array.isArray(parsedDeny.advisories?.ignore), "deny.toml must retain an advisories.ignore array");
  assert.equal(policy.version, 1);
  assert.match(policy.owner, /^@[A-Za-z0-9-]+$/);
  assert.match(policy.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  const reviewDeadline = Date.parse(`${policy.reviewBy}T23:59:59.999Z`);
  assert.ok(Number.isFinite(reviewDeadline), "Rust advisory reviewBy must be a valid UTC calendar date");
  assert.equal(
    new Date(reviewDeadline).toISOString().slice(0, 10),
    policy.reviewBy,
    "Rust advisory reviewBy must not normalize an impossible calendar date"
  );
  assert.ok(Date.now() <= reviewDeadline, `Rust advisory exceptions expired on ${policy.reviewBy}`);

  const configuredExceptions = parsedDeny.advisories.ignore.map(rustDenyExceptionIdentity).sort();
  assert.deepEqual([...policy.denyExceptions].sort(), configuredExceptions);

  const documentedAdvisories = new Set(policy.advisoryGroups.flatMap((group) => group.advisoryIds));
  const documentedPackages = new Set(policy.advisoryGroups.flatMap((group) => group.packages));
  for (const exception of policy.denyExceptions) {
    if (exception.startsWith("RUSTSEC-")) {
      assert.ok(documentedAdvisories.has(exception), `${exception} lacks structured ownership and reachability`);
    } else if (exception.startsWith("crate:")) {
      const packageIdentity = exception.slice("crate:".length).replace("@", " ");
      assert.ok(documentedPackages.has(packageIdentity), `${exception} lacks structured ownership and reachability`);
    } else {
      assert.fail(`Unsupported Rust deny exception identity: ${exception}`);
    }
  }
  for (const group of policy.advisoryGroups) {
    for (const field of ["name", "dependencyPath", "platformScope", "reachability", "disposition"]) {
      assert.equal(typeof group[field], "string", `${group.name ?? "advisory group"}.${field} must be documented`);
      assert.ok(group[field].trim().length > 0, `${group.name}.${field} must not be empty`);
    }
  }
});

test("required-only journey dispatch excludes every scheduled depth job", () => {
  const workflow = readFileSync(".github/workflows/journeys.yml", "utf8");
  assert.match(workflow, /When true, run only the four branch-protected pull-request journey jobs/);
  assert.equal(
    workflow.match(/workflow_dispatch' && inputs\.required_only == false/g)?.length,
    4,
    "all four scheduled depth job groups must require full dispatch mode"
  );
  assert.doesNotMatch(workflow, /inputs\.required_only != true/);
});

test("release publication mutates drafts only and verifies remote names before publication", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.doesNotMatch(workflow, /gh release upload[^\n]*--clobber/);
  assert.match(workflow, /assert_private_draft\(\)/);
  assert.match(workflow, /gh release delete-asset/);
  assert.match(workflow, /validate-release-asset-digests\.mjs/);
  assert.match(workflow, /already public with the exact authenticated asset set/);
  const remoteVerification = workflow.indexOf("check-release-assets.mjs published-list");
  const publication = workflow.indexOf('gh release edit "$RELEASE_TAG" --draft=false');
  assert.ok(
    remoteVerification > 0 && publication > remoteVerification,
    "remote exact-name verification must precede publication"
  );
});

test("release packaging discards cached bundles and selects only the current version DMG", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const clearBundle = workflow.indexOf("rm -rf apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle");
  const signedBuild = workflow.indexOf("npm run tauri:build:release -w @multaiplayer/desktop");
  assert.ok(clearBundle > 0 && clearBundle < signedBuild, "cached bundle output must be removed before signing");
  assert.equal(
    workflow.match(/dmg_path="\$bundle_root\/dmg\/multAIplayer_\$\{release_version\}_aarch64\.dmg"/g)?.length,
    2,
    "verification and packaging must select the exact package-version DMG"
  );
  assert.doesNotMatch(workflow, /find[^\n]+-name '\*\.dmg'[^\n]+head/);
});

test("release source is resolved once to an immutable main-reachable commit", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /gh workflow run release\.yml --ref "\$RELEASE_TAG" --field tag="\$RELEASE_TAG"/);
  assert.match(workflow, /RELEASE_EVENT_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /RELEASE_EVENT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /\[ "\$RELEASE_EVENT_REF" != "refs\/tags\/\$tag" \]/);
  assert.match(workflow, /git rev-parse "refs\/tags\/\$tag\^\{commit\}"/);
  assert.match(workflow, /\[ "\$commit" != "\$RELEASE_EVENT_SHA" \]/);
  assert.match(workflow, /git merge-base --is-ancestor "\$commit" refs\/remotes\/origin\/main/);
  assert.match(workflow, /release-native-gate:[\s\S]*?ref: \$\{\{ needs\.resolve\.outputs\.commit \}\}/);
  assert.match(workflow, /build:[\s\S]*?ref: \$\{\{ needs\.resolve\.outputs\.commit \}\}/);
  assert.match(workflow, /publish:[\s\S]*?ref: \$\{\{ needs\.build\.outputs\.commit \}\}/);
  assert.match(workflow, /if \[ "\$remote_commit" != "\$RELEASE_COMMIT" \]/);
});

test("public release classification precedes build and publish transparency mutations", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const earlyRejection = workflow.indexOf("refusing to rebuild or emit new transparency records");
  const nativeGate = workflow.indexOf("  release-native-gate:");
  assert.ok(earlyRejection > 0 && earlyRejection < nativeGate);
  const publish = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  advance-updater-channel:"));
  const classification = publish.indexOf("Classify an ambiguous publication retry");
  const attestation = publish.indexOf("Attest release artifact provenance");
  assert.ok(classification > 0 && classification < attestation);
  assert.match(publish, /check-release-assets\.mjs published "\$RUNNER_TEMP\/public-release-assets"/);
  assert.match(publish, /check-release-assets\.mjs build release-assets/);
  assert.match(
    publish,
    /Attest release artifact provenance\n\s+if: steps\.public-state\.outputs\.already_public != 'true'/
  );
  assert.match(workflow, /Re-run failed jobs action on that run/);
  assert.match(workflow, /elif ! grep -q '\(HTTP 404\)' "\$release_error"/);
});

test("tag identity is rechecked at both irreversible publication boundaries", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const publicationCheck = workflow.indexOf("Release tag moved before publication");
  const publication = workflow.indexOf('gh release edit "$RELEASE_TAG" --draft=false');
  assert.ok(publicationCheck > 0 && publicationCheck < publication);
  const channelCheck = workflow.indexOf("Release tag moved before updater-channel advancement");
  const channelWrite = workflow.lastIndexOf('gh api "${request[@]}"');
  assert.ok(channelCheck > publication && channelCheck < channelWrite);
});

test("updater channel advancement is serialized and refuses SemVer regression", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const channel = workflow.slice(workflow.indexOf("  advance-updater-channel:"));
  assert.match(channel, /group: updater-availability-channel/);
  assert.match(channel, /cancel-in-progress: false/);
  assert.match(channel, /check-updater-channel-order\.mjs/);
  assert.match(channel, /cmp -s public-release-assets\/latest\.json/);
  assert.match(channel, /-f sha="\$existing_sha"/);
});

test("release-note check rejects normalized duplicates", () => {
  const fixture =
    "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n* Same fix ([abcdef1](https://example.test/a))\n* Same fix ([abcdef2](https://example.test/b))\n";
  const result = spawnSync(process.execPath, ["tools/release/check-release-notes.mjs", "/dev/stdin"], {
    input: fixture
  });
  assert.notEqual(result.status, 0);
});

test("release asset validator enforces the public build contract", () => {
  const directory = mkdtempSync(join(tmpdir(), "multaiplayer-assets-"));
  const contract = JSON.parse(readFileSync("docs/release-assets.v1.json", "utf8"));
  const releaseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  for (const name of contract.buildOutputExactNames) writeFileSync(join(directory, name), "fixture");
  const dmgName = `multAIplayer_${releaseVersion}_aarch64.dmg`;
  writeFileSync(join(directory, dmgName), "fixture");
  assert.equal(spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "build", directory]).status, 0);
  unlinkSync(join(directory, dmgName));
  writeFileSync(join(directory, "multAIplayer_9.9.9-alpha.9_aarch64.dmg"), "stale fixture");
  assert.notEqual(
    spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "build", directory]).status,
    0,
    "a stale versioned DMG must not satisfy the current release contract"
  );
  unlinkSync(join(directory, "multAIplayer_9.9.9-alpha.9_aarch64.dmg"));
  writeFileSync(join(directory, dmgName), "fixture");
  writeFileSync(join(directory, "unexpected-debug-symbols.zip"), "fixture");
  assert.notEqual(
    spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "build", directory]).status,
    0,
    "unexpected assets must fail the exact public contract"
  );
  unlinkSync(join(directory, "unexpected-debug-symbols.zip"));
  unlinkSync(join(directory, contract.buildOutputExactNames[0]));
  assert.notEqual(
    spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "build", directory]).status,
    0
  );
});

test("release asset validator accepts the exact remote published-name projection", () => {
  const directory = mkdtempSync(join(tmpdir(), "multaiplayer-remote-assets-"));
  const namesPath = join(directory, "names.txt");
  const contract = JSON.parse(readFileSync("docs/release-assets.v1.json", "utf8"));
  const releaseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const names = [...contract.requiredExactNames, `multAIplayer_${releaseVersion}_aarch64.dmg`];
  writeFileSync(namesPath, `${names.join("\n")}\n`);
  assert.equal(
    spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "published-list", namesPath]).status,
    0
  );
  writeFileSync(namesPath, `${names.join("\n")}\nstale-asset.txt\n`);
  assert.notEqual(
    spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "published-list", namesPath]).status,
    0
  );
});

test("relay runtime closure prunes undeclared packages and detects later additions", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-relay-closure-"));
  const nodeModules = join(root, "node_modules");
  const packageDirectory = (name) => join(nodeModules, ...name.split("/"));
  const writePackage = (name, version) => {
    mkdirSync(packageDirectory(name), { recursive: true });
    writeFileSync(join(packageDirectory(name), "package.json"), JSON.stringify({ name, version }));
  };
  writePackage("@multaiplayer/relay", "1.0.0");
  writePackage("allowed", "2.0.0");
  writePackage("unexpected", "9.0.0");
  const treePath = join(root, "tree.json");
  const evidencePath = join(root, "evidence.json");
  writeFileSync(
    treePath,
    JSON.stringify({
      dependencies: {
        "@multaiplayer/relay": {
          version: "1.0.0",
          dependencies: { allowed: { version: "2.0.0", dependencies: { absent: {} } } }
        }
      }
    })
  );
  const allowedManifestPath = join(packageDirectory("allowed"), "package.json");
  writeFileSync(
    allowedManifestPath,
    JSON.stringify({
      name: "allowed",
      version: "2.0.0",
      peerDependencies: { absent: "^1.0.0" },
      peerDependenciesMeta: { absent: { optional: true } }
    })
  );
  assert.equal(
    spawnSync(process.execPath, [
      "tools/release/relay-runtime-dependency-closure.mjs",
      "prune",
      nodeModules,
      evidencePath,
      treePath
    ]).status,
    0
  );
  assert.equal(existsSync(packageDirectory("unexpected")), false);
  assert.equal(
    spawnSync(process.execPath, [
      "tools/release/relay-runtime-dependency-closure.mjs",
      "verify",
      nodeModules,
      evidencePath
    ]).status,
    0
  );
  writePackage("unexpected", "9.0.0");
  assert.notEqual(
    spawnSync(process.execPath, [
      "tools/release/relay-runtime-dependency-closure.mjs",
      "verify",
      nodeModules,
      evidencePath
    ]).status,
    0
  );
});

test("relay runtime image preserves workspace-local production dependencies before closure verification", () => {
  const dockerfile = readFileSync("apps/relay/Dockerfile", "utf8");
  const workspaceDependencies = "COPY --from=build /app/apps/relay/node_modules ./apps/relay/node_modules";
  const verifyClosure = dockerfile.lastIndexOf("RUN node tools/release/relay-runtime-dependency-closure.mjs");
  assert.ok(dockerfile.includes(workspaceDependencies));
  assert.ok(
    verifyClosure >= 0 && dockerfile.indexOf(workspaceDependencies) < verifyClosure,
    "workspace-local dependencies must be copied before runtime closure verification"
  );
});

test("relay runtime closure rejects unresolved dependencies that are not manifest-declared optional peers", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-relay-unresolved-"));
  const nodeModules = join(root, "node_modules");
  const relay = join(nodeModules, "@multaiplayer", "relay");
  mkdirSync(relay, { recursive: true });
  writeFileSync(join(relay, "package.json"), JSON.stringify({ name: "@multaiplayer/relay", version: "1.0.0" }));
  const treePath = join(root, "tree.json");
  writeFileSync(
    treePath,
    JSON.stringify({
      dependencies: { "@multaiplayer/relay": { version: "1.0.0", dependencies: { unresolved: {} } } }
    })
  );
  assert.notEqual(
    spawnSync(process.execPath, [
      "tools/release/relay-runtime-dependency-closure.mjs",
      "check-tree",
      nodeModules,
      treePath
    ]).status,
    0
  );
});

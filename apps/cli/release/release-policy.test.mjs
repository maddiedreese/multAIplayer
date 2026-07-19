import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  artifactStem,
  parseCargoPackageVersion,
  readReleaseConfig,
  signingArguments,
  validateDependencyLicenses,
  validateSignatureMetadata
} from "./release-lib.mjs";

const root = resolve(import.meta.dirname, "../../..");
const config = readReleaseConfig();

test("CLI release identity is independent and matches its Cargo package", () => {
  const cargo = readFileSync(resolve(root, "apps/cli/Cargo.toml"), "utf8");
  const desktop = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
  assert.equal(parseCargoPackageVersion(cargo), config.version);
  assert.notEqual(config.version, desktop.version);
  assert.equal(config.binary, "multAIplayer");
  assert.equal(artifactStem(config), `multAIplayer-cli-v${config.version}-darwin-arm64`);
});

test("CLI packaging is local-only and cannot publish or mutate desktop release inputs", () => {
  const sources = ["package-cli.mjs", "verify-package.mjs", "release-lib.mjs"]
    .map((name) => readFileSync(new URL(name, import.meta.url), "utf8"))
    .join("\n");
  for (const forbidden of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "tools/release/",
    "apps/desktop/src-tauri/Cargo.lock",
    "gh release",
    "git tag",
    "git push",
    "notarytool"
  ]) {
    assert.equal(sources.includes(forbidden), false, `CLI packaging must not reference ${forbidden}`);
  }
  assert.match(sources, /manual-owner-approval-required/);
  assert.match(sources, /desktopReleaseContract/);
});

test("ad-hoc and Developer ID signing modes are explicit and cannot be confused", () => {
  assert.deepEqual(signingArguments("-", "/tmp/multAIplayer"), [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    "/tmp/multAIplayer"
  ]);
  assert.deepEqual(signingArguments("Developer ID Application: Example (ABCDEFGHIJ)", "/tmp/multAIplayer"), [
    "--force",
    "--sign",
    "Developer ID Application: Example (ABCDEFGHIJ)",
    "--timestamp",
    "/tmp/multAIplayer"
  ]);

  const adhoc = {
    mode: "adhoc-local-verification",
    identityKind: "adhoc",
    secureTimestamp: false,
    authority: null,
    teamIdentifier: null,
    timestamp: null
  };
  const developerId = {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: true,
    authority: "Developer ID Application: Example (ABCDEFGHIJ)",
    teamIdentifier: "ABCDEFGHIJ",
    timestamp: "Jul 19, 2026 at 12:00:00 PM"
  };
  assert.doesNotThrow(() => validateSignatureMetadata(adhoc));
  assert.doesNotThrow(() => validateSignatureMetadata(developerId));
  assert.throws(() => validateSignatureMetadata({ ...adhoc, mode: developerId.mode }));
  assert.throws(() => validateSignatureMetadata({ ...developerId, secureTimestamp: false }));
});

test("dependency license expressions are fail-closed against the reviewed release allowlist", () => {
  const reviewed = [{ name: "reviewed", version: "1.0.0", license: config.allowedLicenseExpressions[0] }];
  assert.doesNotThrow(() => validateDependencyLicenses(reviewed, config.allowedLicenseExpressions));
  assert.throws(() =>
    validateDependencyLicenses(
      [{ name: "unknown", version: "1.0.0", license: "LicenseRef-Unreviewed" }],
      config.allowedLicenseExpressions
    )
  );
  assert.throws(() =>
    validateDependencyLicenses([{ name: "missing", version: "1.0.0" }], config.allowedLicenseExpressions)
  );
});

test("desktop release contracts contain no CLI package reference", () => {
  for (const path of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "scripts/check-release-versions.mjs",
    "tools/release/sync-release-metadata.mjs"
  ]) {
    assert.doesNotMatch(readFileSync(resolve(root, path), "utf8"), /apps\/cli|multAIplayer-cli/);
  }
});

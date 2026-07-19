import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  artifactStem,
  assertSignatureMetadataMatchesObserved,
  assertSafeOutputDirectory,
  parseCodeSignatureDetails,
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

test("package output rejects symlink escapes before external mutation", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "multaiplayer-cli-output-safety-"));
  const workspace = resolve(fixture, "workspace");
  const external = resolve(fixture, "external");
  const sentinel = resolve(external, "sentinel.txt");
  try {
    mkdirSync(workspace);
    mkdirSync(external);
    writeFileSync(sentinel, "preserve me\n");

    symlinkSync(external, resolve(workspace, "link"));
    assert.throws(() => assertSafeOutputDirectory(workspace, resolve(workspace, "link/package")));
    assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");

    symlinkSync(external, resolve(workspace, "dist"));
    assert.throws(() => assertSafeOutputDirectory(workspace, resolve(workspace, "dist")));
    assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");
    assert.equal(existsSync(sentinel), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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

test("observed codesign metadata rejects forged Developer ID and mode claims", () => {
  const observedAdhoc = parseCodeSignatureDetails(
    "Executable=/tmp/multAIplayer\nSignature=adhoc\nTeamIdentifier=not set\n"
  );
  const forgedDeveloperId = {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: true,
    authority: "Developer ID Application: Forged (ABCDEFGHIJ)",
    teamIdentifier: "ABCDEFGHIJ",
    timestamp: "Jul 19, 2026 at 12:00:00 PM"
  };
  assert.throws(() => assertSignatureMetadataMatchesObserved(observedAdhoc, forgedDeveloperId));

  const observedDeveloperId = parseCodeSignatureDetails(
    "Executable=/tmp/multAIplayer\nAuthority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nTimestamp=Jul 19, 2026 at 12:00:00 PM\n"
  );
  assert.throws(() => assertSignatureMetadataMatchesObserved(observedDeveloperId, observedAdhoc));
  assert.doesNotThrow(() =>
    assertSignatureMetadataMatchesObserved(observedDeveloperId, {
      ...forgedDeveloperId,
      authority: "Developer ID Application: Example (ABCDEFGHIJ)"
    })
  );
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
  assert.throws(() =>
    validateDependencyLicenses(
      [{ name: "license-file-only", version: "1.0.0", license_file: "LICENSE.txt" }],
      config.allowedLicenseExpressions
    )
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

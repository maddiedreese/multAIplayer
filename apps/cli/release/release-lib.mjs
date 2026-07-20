import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const releaseRoot = new URL("./", import.meta.url);

export function readReleaseConfig() {
  const config = JSON.parse(readFileSync(new URL("release-config.json", releaseRoot), "utf8"));
  assert.equal(config.schema, "multaiplayer-cli-release-v1");
  assert.equal(config.product, "multAIplayer CLI");
  assert.equal(config.binary, "multAIplayer");
  assert.match(config.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(config.target, "aarch64-apple-darwin");
  assert.equal(config.platform, "darwin-arm64");
  assert.equal(config.archivePrefix, "multAIplayer-cli");
  assert.equal(config.publication, "manual-owner-approval-required");
  assert.ok(Array.isArray(config.allowedLicenseExpressions));
  assert.ok(config.allowedLicenseExpressions.length > 0);
  assert.equal(new Set(config.allowedLicenseExpressions).size, config.allowedLicenseExpressions.length);
  return config;
}

export function artifactStem(config) {
  return `${config.archivePrefix}-v${config.version}-${config.platform}`;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function parseCargoPackageVersion(source) {
  const packageSection = source.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  assert.ok(packageSection, "CLI Cargo.toml must contain a [package] section");
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.ok(version, "CLI Cargo.toml must declare a package version");
  return version;
}

export function assertSafeOutputDirectory(allowedRoot, output) {
  const expectedOutput = resolve(allowedRoot, "dist");
  assert.equal(output, expectedOutput, "package output must be exactly apps/cli/dist");
  assert.equal(
    realpathSync(dirname(output)),
    realpathSync(allowedRoot),
    "package output parent must canonically be the CLI workspace"
  );
  if (existsSync(output)) {
    const outputStat = lstatSync(output);
    assert.equal(outputStat.isSymbolicLink(), false, "apps/cli/dist must not be a symbolic link");
    assert.equal(outputStat.isDirectory(), true, "apps/cli/dist must be a directory when it exists");
  }
}

export function signingArguments(identity, binary) {
  return identity === "-"
    ? ["--force", "--sign", "-", "--timestamp=none", binary]
    : ["--force", "--sign", identity, "--options", "runtime", "--timestamp", binary];
}

export function validateSignatureMetadata(signature) {
  assert.ok(signature && typeof signature === "object", "signature metadata is required");
  if (signature.mode === "adhoc-local-verification") {
    assert.equal(signature.identityKind, "adhoc");
    assert.equal(signature.secureTimestamp, false);
    assert.equal(signature.authority, null);
    assert.equal(signature.teamIdentifier, null);
    assert.equal(signature.timestamp, null);
    assert.equal(signature.hardenedRuntime, false);
    return;
  }
  assert.equal(signature.mode, "developer-id-distribution");
  assert.equal(signature.identityKind, "developer-id-application");
  assert.equal(signature.secureTimestamp, true);
  assert.match(signature.authority, /^Developer ID Application:/);
  assert.match(signature.teamIdentifier, /^[A-Z0-9]{10}$/);
  assert.ok(typeof signature.timestamp === "string" && signature.timestamp.length > 0);
  assert.equal(signature.hardenedRuntime, true);
}

export function parseCodeSignatureDetails(detail) {
  const isAdhoc = /^Signature=adhoc$/m.test(detail);
  if (isAdhoc) {
    return {
      mode: "adhoc-local-verification",
      identityKind: "adhoc",
      secureTimestamp: false,
      authority: null,
      teamIdentifier: null,
      timestamp: null,
      hardenedRuntime: false
    };
  }
  const authority = detail.match(/^Authority=(.+)$/m)?.[1] || null;
  const rawTeamIdentifier = detail.match(/^TeamIdentifier=(.+)$/m)?.[1] || null;
  const timestamp = detail.match(/^Timestamp=(.+)$/m)?.[1] || null;
  const hardenedRuntime = /^Runtime Version=.+$/m.test(detail);
  return {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: timestamp !== null,
    authority,
    teamIdentifier: rawTeamIdentifier === "not set" ? null : rawTeamIdentifier,
    timestamp,
    hardenedRuntime
  };
}

export function inspectCodeSignature(binary) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", binary], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "codesign signature inspection failed");
  return parseCodeSignatureDetails(`${result.stdout}${result.stderr}`);
}

export function assertSignatureMetadataMatchesObserved(observed, claimed) {
  validateSignatureMetadata(observed);
  validateSignatureMetadata(claimed);
  assert.deepEqual(claimed, observed, "claimed signature metadata must exactly match the extracted binary");
}

export function validateDependencyLicenses(packages, allowedExpressions) {
  const missingExpression = packages.filter((pkg) => !pkg.license);
  assert.deepEqual(
    missingExpression.map((pkg) => `${pkg.name}@${pkg.version}`),
    [],
    "every dependency must declare an explicitly reviewed SPDX license expression"
  );
  const allowed = new Set(allowedExpressions);
  const unreviewed = packages.filter((pkg) => pkg.license && !allowed.has(pkg.license));
  assert.deepEqual(
    unreviewed.map((pkg) => `${pkg.name}@${pkg.version}:${pkg.license}`),
    [],
    "every dependency license expression must be explicitly reviewed"
  );
}

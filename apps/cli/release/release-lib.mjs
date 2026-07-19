import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
  const packageSection = source.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|\z)/m)?.[1];
  assert.ok(packageSection, "CLI Cargo.toml must contain a [package] section");
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.ok(version, "CLI Cargo.toml must declare a package version");
  return version;
}

export function assertSafeOutputDirectory(allowedRoot, output) {
  assert.notEqual(output, allowedRoot, "package output must not replace the CLI workspace");
  assert.ok(output.startsWith(`${allowedRoot}/`), "package output must be inside the CLI workspace");
}

export function signingArguments(identity, binary) {
  return identity === "-"
    ? ["--force", "--sign", "-", "--timestamp=none", binary]
    : ["--force", "--sign", identity, "--timestamp", binary];
}

export function validateSignatureMetadata(signature) {
  assert.ok(signature && typeof signature === "object", "signature metadata is required");
  if (signature.mode === "adhoc-local-verification") {
    assert.equal(signature.identityKind, "adhoc");
    assert.equal(signature.secureTimestamp, false);
    assert.equal(signature.authority, null);
    assert.equal(signature.teamIdentifier, null);
    assert.equal(signature.timestamp, null);
    return;
  }
  assert.equal(signature.mode, "developer-id-distribution");
  assert.equal(signature.identityKind, "developer-id-application");
  assert.equal(signature.secureTimestamp, true);
  assert.match(signature.authority, /^Developer ID Application:/);
  assert.match(signature.teamIdentifier, /^[A-Z0-9]{10}$/);
  assert.ok(typeof signature.timestamp === "string" && signature.timestamp.length > 0);
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

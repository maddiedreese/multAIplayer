#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactStem,
  assertNoProtectedEntitlements,
  assertSignatureMetadataMatchesObserved,
  bindProvisioningProfileToSigningCertificate,
  inspectProvisioningProfile,
  inspectCodeSignature,
  inspectSignedEntitlements,
  inspectSigningCertificate,
  readReleaseConfig,
  sha256File,
  validateProtectedEntitlements,
  validateSignatureMetadata
} from "./release-lib.mjs";

const releaseDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(releaseDir, "..");
const outputFlag = process.argv.indexOf("--output");
assert.ok(outputFlag !== -1 && process.argv[outputFlag + 1], "--output requires a package directory");
const output = resolve(process.argv[outputFlag + 1]);
const config = readReleaseConfig();
const stem = artifactStem(config);
const archive = resolve(output, `${stem}.tar.gz`);
const manifestPath = resolve(output, `${stem}.manifest.json`);
const sumsPath = resolve(output, "SHA256SUMS.txt");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

assert.equal(manifest.schema, "multaiplayer-cli-release-manifest-v1");
assert.equal(manifest.product, config.product);
assert.equal(manifest.binary, config.binary);
assert.equal(manifest.bundle, config.bundle);
assert.equal(manifest.bundleIdentifier, config.bundleIdentifier);
assert.equal(manifest.version, config.version);
assert.equal(manifest.target, config.target);
assert.equal(manifest.platform, config.platform);
assert.match(manifest.sourceRevision, /^[0-9a-f]{40}$/);
assert.equal(manifest.archive, basename(archive));
assert.equal(manifest.archiveSha256, sha256File(archive));
assert.equal(manifest.publication, "manual-owner-approval-required");
assert.equal(manifest.desktopReleaseContract, false);
validateSignatureMetadata(manifest.signature);

const expectedSums = `${manifest.archiveSha256}  ${manifest.archive}\n${sha256File(manifestPath)}  ${basename(manifestPath)}\n`;
assert.equal(readFileSync(sumsPath, "utf8"), expectedSums, "checksum manifest must bind archive and manifest");

const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
const expectedEntries = [
  `${stem}/`,
  `${stem}/BUILD-METADATA.json`,
  `${stem}/INSTALL.md`,
  `${stem}/LICENSE`,
  `${stem}/THIRD_PARTY_NOTICES.md`,
  `${stem}/${config.bundle}/`,
  `${stem}/${config.bundle}/Contents/`,
  `${stem}/${config.bundle}/Contents/Info.plist`,
  `${stem}/${config.bundle}/Contents/MacOS/`,
  `${stem}/${config.bundle}/Contents/MacOS/${config.binary}`,
  `${stem}/${config.bundle}/Contents/_CodeSignature/`,
  `${stem}/${config.bundle}/Contents/_CodeSignature/CodeResources`,
  ...(manifest.signature.mode === "developer-id-distribution"
    ? [`${stem}/${config.bundle}/Contents/embedded.provisionprofile`]
    : [])
];
assert.deepEqual([...entries].sort(), expectedEntries.sort(), "archive contents must be exact and bounded");
assert.equal(
  entries.some((entry) => entry.startsWith("/") || entry.includes("../")),
  false,
  "archive paths must be relative"
);
const verboseEntries = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).trim().split("\n");
assert.equal(verboseEntries.length, entries.length, "archive type listing must cover every entry");
for (let index = 0; index < entries.length; index += 1) {
  const expectedType = entries[index].endsWith("/") ? "d" : "-";
  assert.equal(
    verboseEntries[index][0],
    expectedType,
    `archive entry must be a regular ${expectedType === "d" ? "directory" : "file"}: ${entries[index]}`
  );
}

const temporary = mkdtempSync(resolve(tmpdir(), "multaiplayer-cli-package-"));
try {
  run("tar", ["-xzf", archive, "-C", temporary]);
  const packageRoot = resolve(temporary, stem);
  const bundle = resolve(packageRoot, config.bundle);
  const binary = resolve(bundle, "Contents", "MacOS", config.binary);
  run("codesign", ["--verify", "--strict", "--verbose=2", bundle]);
  const observedSignature = inspectCodeSignature(bundle);
  assertSignatureMetadataMatchesObserved(observedSignature, manifest.signature);
  const bundleIdentifier = execFileSync(
    "plutil",
    ["-extract", "CFBundleIdentifier", "raw", "-o", "-", resolve(bundle, "Contents", "Info.plist")],
    { encoding: "utf8" }
  ).trim();
  assert.equal(bundleIdentifier, config.bundleIdentifier);
  const bundleReleaseVersion = execFileSync(
    "plutil",
    ["-extract", "MultAIplayerCLIVersion", "raw", "-o", "-", resolve(bundle, "Contents", "Info.plist")],
    { encoding: "utf8" }
  ).trim();
  assert.equal(bundleReleaseVersion, config.version, "Info.plist must bind the exact CLI release version");

  if (manifest.signature.mode === "developer-id-distribution") {
    assert.equal(observedSignature.teamIdentifier, config.teamIdentifier);
    const entitlements = inspectSignedEntitlements(bundle);
    validateProtectedEntitlements(entitlements, config);
    assert.deepEqual(entitlements, manifest.signedEntitlements);
    const profile = inspectProvisioningProfile(resolve(bundle, "Contents", "embedded.provisionprofile"), config);
    const signingCertificate = inspectSigningCertificate(bundle);
    const signingCertificateSha256 = bindProvisioningProfileToSigningCertificate(profile.decoded, signingCertificate);
    assert.deepEqual(
      { ...profile.metadata, signingCertificateSha256 },
      manifest.provisioningProfile,
      "the embedded profile must contain the exact observed leaf signing certificate"
    );
  } else {
    assert.equal(manifest.provisioningProfile, null);
    assert.deepEqual(manifest.signedEntitlements, {});
    assertNoProtectedEntitlements(manifest.signedEntitlements, config);
  }
  const architectures = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim().split(/\s+/);
  assert.deepEqual(architectures, ["arm64"], "package must contain only an Apple-silicon executable");
  assert.equal(execFileSync(binary, ["--version"], { encoding: "utf8" }), `${config.binary} ${config.version}\n`);

  const build = JSON.parse(readFileSync(resolve(packageRoot, "BUILD-METADATA.json"), "utf8"));
  assert.equal(build.schema, "multaiplayer-cli-build-v1");
  assert.equal(build.sourceRevision, manifest.sourceRevision);
  assert.equal(build.sourceDateEpoch, manifest.sourceDateEpoch);
  assert.equal(build.binarySha256, manifest.binarySha256);
  assert.equal(sha256File(binary), manifest.binarySha256);
  assert.deepEqual(build.signature, manifest.signature);
  assert.deepEqual(build.signedEntitlements, manifest.signedEntitlements);
  assert.deepEqual(build.provisioningProfile, manifest.provisioningProfile);
  assert.match(readFileSync(resolve(packageRoot, "LICENSE"), "utf8"), /Apache License/);
  assert.match(readFileSync(resolve(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8"), /locked Cargo dependency graph/);
  assert.match(readFileSync(resolve(packageRoot, "INSTALL.md"), "utf8"), /codesign --verify/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`Verified ${archive}`);
console.log(`Binary: ${config.binary} ${config.version} (arm64)`);
console.log(`Source revision: ${manifest.sourceRevision}`);
console.log(`Signature mode: ${manifest.signature.mode}`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: cliRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactStem,
  assertSignatureMetadataMatchesObserved,
  inspectCodeSignature,
  readReleaseConfig,
  sha256File,
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
  `${stem}/${config.binary}`
];
assert.deepEqual([...entries].sort(), expectedEntries.sort(), "archive contents must be exact and bounded");
assert.equal(
  entries.some((entry) => entry.startsWith("/") || entry.includes("../")),
  false,
  "archive paths must be relative"
);

const temporary = mkdtempSync(resolve(tmpdir(), "multaiplayer-cli-package-"));
try {
  run("tar", ["-xzf", archive, "-C", temporary]);
  const packageRoot = resolve(temporary, stem);
  const binary = resolve(packageRoot, config.binary);
  run("codesign", ["--verify", "--strict", "--verbose=2", binary]);
  const observedSignature = inspectCodeSignature(binary);
  assertSignatureMetadataMatchesObserved(observedSignature, manifest.signature);
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

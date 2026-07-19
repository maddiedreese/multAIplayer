#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactStem,
  assertSafeOutputDirectory,
  inspectCodeSignature,
  parseCargoPackageVersion,
  readReleaseConfig,
  sha256File,
  signingArguments,
  validateDependencyLicenses,
  validateSignatureMetadata
} from "./release-lib.mjs";

const releaseDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(releaseDir, "../../..");
const cliRoot = resolve(root, "apps/cli");
const outputFlag = process.argv.indexOf("--output");
const output = resolve(outputFlag === -1 ? resolve(cliRoot, "dist") : process.argv[outputFlag + 1]);
const signingFlag = process.argv.indexOf("--signing-identity");
const signingIdentity =
  signingFlag === -1 ? process.env.MULTAIPLAYER_CLI_SIGNING_IDENTITY || "-" : process.argv[signingFlag + 1];

assert.ok(outputFlag === -1 || process.argv[outputFlag + 1], "--output requires a directory");
assert.ok(signingFlag === -1 || process.argv[signingFlag + 1], "--signing-identity requires an identity");
assertSafeOutputDirectory(cliRoot, output);
assert.equal(process.platform, "darwin", "CLI release packaging requires macOS");
assert.equal(process.arch, "arm64", "CLI release packaging requires Apple silicon");

const config = readReleaseConfig();
const cargoManifest = readFileSync(resolve(cliRoot, "Cargo.toml"), "utf8");
assert.equal(parseCargoPackageVersion(cargoManifest), config.version, "release and Cargo versions must match");

const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
assert.equal(status, "", "release packaging requires a clean source tree");
const sourceRevision = git(["rev-parse", "HEAD"]);
assert.match(sourceRevision, /^[0-9a-f]{40}$/);
const sourceDateEpoch = Number(git(["show", "-s", "--format=%ct", sourceRevision]));
assert.ok(Number.isSafeInteger(sourceDateEpoch) && sourceDateEpoch > 0, "source commit timestamp is invalid");

run(
  "cargo",
  [
    "build",
    "--locked",
    "--release",
    "--target",
    config.target,
    "--manifest-path",
    resolve(cliRoot, "Cargo.toml"),
    "--bin",
    config.binary
  ],
  {
    ...process.env,
    CARGO_INCREMENTAL: "0",
    SOURCE_DATE_EPOCH: String(sourceDateEpoch)
  }
);

const builtBinary = resolve(cliRoot, "target", config.target, "release", config.binary);
const stem = artifactStem(config);
const packageRoot = resolve(output, stem);
const archive = resolve(output, `${stem}.tar.gz`);
const manifestPath = resolve(output, `${stem}.manifest.json`);
const sumsPath = resolve(output, "SHA256SUMS.txt");

rmSync(output, { recursive: true, force: true });
mkdirSync(packageRoot, { recursive: true, mode: 0o755 });
cpSync(builtBinary, resolve(packageRoot, config.binary));
chmodSync(resolve(packageRoot, config.binary), 0o755);
cpSync(resolve(root, "LICENSE"), resolve(packageRoot, "LICENSE"));
cpSync(resolve(releaseDir, "INSTALL.md"), resolve(packageRoot, "INSTALL.md"));

const notices = dependencyNotices();
writeFileSync(resolve(packageRoot, "THIRD_PARTY_NOTICES.md"), notices);

run("codesign", signingArguments(signingIdentity, resolve(packageRoot, config.binary)));
run("codesign", ["--verify", "--strict", "--verbose=2", resolve(packageRoot, config.binary)]);

const binarySha256 = sha256File(resolve(packageRoot, config.binary));
const signature = inspectCodeSignature(resolve(packageRoot, config.binary));
assert.equal(
  signature.mode,
  signingIdentity === "-" ? "adhoc-local-verification" : "developer-id-distribution",
  "observed signing mode must match the selected signing identity"
);
validateSignatureMetadata(signature);
const buildMetadata = {
  schema: "multaiplayer-cli-build-v1",
  product: config.product,
  binary: config.binary,
  version: config.version,
  target: config.target,
  platform: config.platform,
  sourceRevision,
  sourceDateEpoch,
  binarySha256,
  signature
};
writeFileSync(resolve(packageRoot, "BUILD-METADATA.json"), `${JSON.stringify(buildMetadata, null, 2)}\n`);

run("tar", ["-czf", archive, stem], { ...process.env, COPYFILE_DISABLE: "1" }, output);

const releaseManifest = {
  schema: "multaiplayer-cli-release-manifest-v1",
  product: config.product,
  binary: config.binary,
  version: config.version,
  target: config.target,
  platform: config.platform,
  sourceRevision,
  sourceDateEpoch,
  archive: `${stem}.tar.gz`,
  archiveSha256: sha256File(archive),
  binarySha256,
  signature,
  publication: config.publication,
  desktopReleaseContract: false
};
writeFileSync(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
writeFileSync(
  sumsPath,
  `${releaseManifest.archiveSha256}  ${releaseManifest.archive}\n${sha256File(manifestPath)}  ${stem}.manifest.json\n`
);

rmSync(packageRoot, { recursive: true });
run(process.execPath, [resolve(releaseDir, "verify-package.mjs"), "--output", output]);
console.log(`Created ${archive}`);
console.log(`Source revision: ${sourceRevision}`);
console.log(`Signing mode: ${signature.mode}`);

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function run(command, args, env = process.env, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

function dependencyNotices() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--offline", "--format-version", "1", "--manifest-path", resolve(cliRoot, "Cargo.toml")],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    )
  );
  const packages = [...metadata.packages]
    .filter((pkg) => pkg.name !== "multaiplayer-cli")
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  validateDependencyLicenses(packages, config.allowedLicenseExpressions);
  const lines = [
    "# multAIplayer CLI third-party notices",
    "",
    `Generated from the locked Cargo dependency graph for ${sourceRevision}.`,
    "The archive also includes the multAIplayer Apache-2.0 license.",
    "",
    "| Package | Version | License | Source |",
    "| --- | --- | --- | --- |"
  ];
  for (const pkg of packages) {
    const license = pkg.license || `License file: ${pkg.license_file}`;
    lines.push(
      `| ${escapeCell(pkg.name)} | ${escapeCell(pkg.version)} | ${escapeCell(license)} | ${escapeCell(pkg.source || "workspace path")} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}

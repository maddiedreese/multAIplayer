import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cargoRoot = "apps/desktop/src-tauri";
const workspaceManifests = [
  `${cargoRoot}/Cargo.toml`,
  `${cargoRoot}/crates/codex-activity-projection/Cargo.toml`,
  `${cargoRoot}/crates/mls-core/Cargo.toml`,
  `${cargoRoot}/crates/typed-tauri-command/Cargo.toml`
];

for (const manifestPath of workspaceManifests) {
  const manifest = readFileSync(manifestPath, "utf8");
  assert.match(manifest, /^license\s*=\s*"Apache-2\.0"\s*$/m, `${manifestPath} must declare Apache-2.0`);
}

const rootManifest = readFileSync(`${cargoRoot}/Cargo.toml`, "utf8");
const mlsManifest = readFileSync(`${cargoRoot}/crates/mls-core/Cargo.toml`, "utf8");
const lockfile = readFileSync(`${cargoRoot}/Cargo.lock`, "utf8");
const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");

const reviewedVersions = new Map([
  ["portable-pty", exactManifestVersion(rootManifest, "portable-pty")],
  ["hpke", exactManifestVersion(mlsManifest, "hpke")],
  ["mls-rs", exactManifestVersion(mlsManifest, "mls-rs")],
  ["mls-rs-core", exactManifestVersion(mlsManifest, "mls-rs-core")],
  ["mls-rs-crypto-awslc", exactManifestVersion(mlsManifest, "mls-rs-crypto-awslc")],
  ["mls-rs-provider-sqlite", exactManifestVersion(mlsManifest, "mls-rs-provider-sqlite")],
  ["aws-lc-rs", uniqueLockedVersion(lockfile, "aws-lc-rs")],
  ["libsqlite3-sys", uniqueLockedVersion(lockfile, "libsqlite3-sys")]
]);

const noticeLines = notices.split("\n");
for (const [name, version] of reviewedVersions) {
  assert.ok(
    lockedVersions(lockfile, name).includes(version),
    `${name} ${version} from the reviewed native inventory must remain in Cargo.lock`
  );
  const line = noticeLines.find((candidate) => candidate.includes(`\`${name}\``));
  assert.ok(line, `THIRD_PARTY_NOTICES.md must name ${name}`);
  assert.match(line, new RegExp(`(?:^|\\s)${escapeRegex(version)}(?:\\s|,|$)`), `${name} notice must name ${version}`);
}

console.log("Cargo workspace licenses and reviewed native-component notices match the locked dependency graph.");

function exactManifestVersion(manifest, name) {
  const escaped = escapeRegex(name);
  const match = manifest.match(
    new RegExp(`^${escaped}\\s*=\\s*(?:"=([^"]+)"|\\{[^\\n]*version\\s*=\\s*"=([^"]+)")`, "m")
  );
  assert.ok(match, `${name} must use an exact manifest version`);
  return match[1] ?? match[2];
}

function uniqueLockedVersion(lock, name) {
  const versions = lockedVersions(lock, name);
  assert.equal(versions.length, 1, `${name} must have one unambiguous locked version for the reviewed notice`);
  return versions[0];
}

function lockedVersions(lock, name) {
  const escaped = escapeRegex(name);
  return Array.from(lock.matchAll(new RegExp(`^name = "${escaped}"\\nversion = "([^"]+)"`, "gm")), (match) => match[1]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

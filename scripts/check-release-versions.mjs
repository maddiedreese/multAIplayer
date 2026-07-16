import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function assertReleaseVersions(repositoryVersion, metadata) {
  const nativePackage = metadata.packages.find((candidate) => candidate.name === "multaiplayer");
  assert.ok(nativePackage, "Cargo metadata must contain the multaiplayer native package");
  assert.equal(
    nativePackage.version,
    repositoryVersion,
    "native Cargo package version must match the repository release version"
  );
}

export function assertReleasePleaseBootstrap(config, manifest, resolveTagCommit) {
  const rootPackage = config.packages?.["."];
  assert.ok(rootPackage, "release-please must configure the repository root package");
  assert.equal(
    rootPackage["include-component-in-tag"],
    false,
    "release-please root tags must match the existing component-free v* tag convention"
  );
  const version = manifest["."];
  assert.match(version ?? "", /^\d+\.\d+\.\d+/, "release-please manifest must define the root version");
  const bootstrapSha = config["bootstrap-sha"];
  assert.match(bootstrapSha ?? "", /^[0-9a-f]{40}$/, "release-please root package must pin a bootstrap commit");
  assert.equal(
    bootstrapSha,
    resolveTagCommit(`v${version}`),
    "release-please bootstrap commit must be the existing component-free manifest-version tag"
  );
}

function main() {
  const repositoryVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--no-deps",
        "--locked",
        "--manifest-path",
        "apps/desktop/src-tauri/Cargo.toml"
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    )
  );
  assertReleaseVersions(repositoryVersion, metadata);
  const releasePleaseConfig = JSON.parse(readFileSync("release-please-config.json", "utf8"));
  const releasePleaseManifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
  assertReleasePleaseBootstrap(releasePleaseConfig, releasePleaseManifest, (tag) =>
    execFileSync("git", ["rev-list", "-n", "1", tag], { encoding: "utf8" }).trim()
  );
  console.log(
    `Release versions agree at ${repositoryVersion}; Cargo.lock and the component-free release bootstrap are current.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

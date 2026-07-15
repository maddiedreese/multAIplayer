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
  console.log(`Release versions agree at ${repositoryVersion}; Cargo.lock is current.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

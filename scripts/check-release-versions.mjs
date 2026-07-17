import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverWorkspacePackagePaths } from "../tools/release/sync-release-metadata.mjs";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function assertReleaseVersions(repositoryVersion, workspaceEntries, lockfile, metadata, tauriConfig) {
  const localNames = new Set(workspaceEntries.map(({ manifest }) => manifest.name));
  assert.equal(localNames.has(undefined), false, "every workspace must have a package name");
  assert.equal(localNames.size, workspaceEntries.length, "workspace package names must be unique");
  assert.equal(lockfile.version, repositoryVersion, "package-lock root version must match package.json");
  assert.equal(
    lockfile.packages?.[""]?.version,
    repositoryVersion,
    "package-lock root package must match package.json"
  );
  for (const { path, manifest } of workspaceEntries) {
    assert.equal(manifest.version, repositoryVersion, `${path} version must match package.json`);
    assert.equal(lockfile.packages?.[path]?.version, repositoryVersion, `${path} lock entry must match package.json`);
    for (const section of dependencySections) {
      for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
        if (!localNames.has(name)) continue;
        assert.equal(specifier, repositoryVersion, `${path} ${section}.${name} must match package.json`);
        assert.equal(
          lockfile.packages?.[path]?.[section]?.[name],
          repositoryVersion,
          `${path} lock ${section}.${name} must match package.json`
        );
      }
    }
  }
  const nativePackage = metadata.packages.find((candidate) => candidate.name === "multaiplayer");
  assert.ok(nativePackage, "Cargo metadata must contain the multaiplayer native package");
  assert.equal(nativePackage.version, repositoryVersion, "native Cargo package version must match package.json");
  assert.equal(
    tauriConfig.version,
    "../package.json",
    "Tauri must read its version from the desktop workspace manifest"
  );
}

function main() {
  const root = process.cwd();
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const workspaceEntries = discoverWorkspacePackagePaths(root, rootPackage).map((absolutePath) => ({
    path: relative(root, absolutePath)
      .replaceAll("\\", "/")
      .replace(/\/package\.json$/, ""),
    manifest: JSON.parse(readFileSync(absolutePath, "utf8"))
  }));
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
  assertReleaseVersions(
    rootPackage.version,
    workspaceEntries,
    JSON.parse(readFileSync("package-lock.json", "utf8")),
    metadata,
    JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"))
  );
  console.log(
    `Root, ${workspaceEntries.length} workspaces, lockfiles, Cargo, and Tauri agree at ${rootPackage.version}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

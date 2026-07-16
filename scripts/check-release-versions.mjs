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

export function assertReleasePleaseBootstrap(config, manifest, inspectBootstrapCommit) {
  const rootPackage = config.packages?.["."];
  assert.ok(rootPackage, "release-please must configure the repository root package");
  assert.equal(
    rootPackage["include-component-in-tag"],
    false,
    "release tags must use the component-free v* convention"
  );
  assert.equal(rootPackage.draft, true, "release-please must create a draft until release gates pass");
  assert.equal(
    rootPackage["force-tag-creation"],
    true,
    "draft releases must create their immutable build tag before the gated release workflow runs"
  );
  const extraFiles = rootPackage["extra-files"] ?? [];
  assert.deepEqual(
    extraFiles.map(({ path, jsonpath }) => `${path}:${jsonpath}`).sort(),
    ["apps/desktop/package.json:$.version", "apps/desktop/src-tauri/Cargo.toml:$.package.version"],
    "release-please extra-files must contain only irreducible desktop/native version entry points"
  );
  const version = manifest["."];
  assert.match(
    version ?? "",
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "release-please manifest must define the root version"
  );
  const bootstrapSha = config["bootstrap-sha"];
  assert.match(bootstrapSha ?? "", /^[0-9a-f]{40}$/, "release-please must pin a bootstrap commit");
  const bootstrap = inspectBootstrapCommit(bootstrapSha);
  assert.equal(bootstrap?.commit, bootstrapSha, "release-please bootstrap SHA must resolve exactly as a commit");
  assert.equal(bootstrap?.isAncestor, true, "release-please bootstrap commit must be an ancestor of HEAD");
  assert.ok(Array.isArray(bootstrap?.tags), "release-please bootstrap inspection must return its tags");
  assert.ok(
    bootstrap.tags.some((tag) => /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)),
    "release-please bootstrap commit must be anchored by an existing version tag"
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
  const releasePleaseConfig = JSON.parse(readFileSync("release-please-config.json", "utf8"));
  const releasePleaseManifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
  assertReleasePleaseBootstrap(releasePleaseConfig, releasePleaseManifest, (bootstrapSha) => {
    const commit = execFileSync("git", ["rev-parse", `${bootstrapSha}^{commit}`], { encoding: "utf8" }).trim();
    let isAncestor = true;
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", bootstrapSha, "HEAD"], { stdio: "ignore" });
    } catch {
      isAncestor = false;
    }
    const tags = execFileSync("git", ["tag", "--points-at", bootstrapSha, "--list", "v*"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    return { commit, isAncestor, tags };
  });
  console.log(
    `Root, ${workspaceEntries.length} workspaces, lockfiles, Cargo, and Tauri agree at ${rootPackage.version}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

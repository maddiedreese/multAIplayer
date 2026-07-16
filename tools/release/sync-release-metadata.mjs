#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function discoverWorkspacePackagePaths(root, rootPackage) {
  const patterns = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : rootPackage.workspaces?.packages;
  if (!Array.isArray(patterns)) throw new Error("package.json must define npm workspaces");
  const paths = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`unsupported workspace pattern ${pattern}; use a single directory/* pattern`);
    }
    const base = join(root, pattern.slice(0, -2));
    for (const entry of readdirSync(base).sort()) {
      const packagePath = join(base, entry, "package.json");
      if (existsSync(packagePath) && statSync(dirname(packagePath)).isDirectory() && statSync(packagePath).isFile()) {
        paths.push(packagePath);
      }
    }
  }
  return paths;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function synchronizeWorkspaceManifests(root = process.cwd()) {
  const rootPath = join(root, "package.json");
  const rootPackage = readJson(rootPath);
  const version = rootPackage.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`invalid root version ${version}`);
  const workspacePaths = discoverWorkspacePackagePaths(root, rootPackage);
  const workspaces = workspacePaths.map((path) => ({ path, manifest: readJson(path) }));
  const localNames = new Set(workspaces.map(({ manifest }) => manifest.name));
  if (localNames.size !== workspaces.length || localNames.has(undefined)) {
    throw new Error("every discovered workspace must have a unique package name");
  }
  for (const workspace of workspaces) {
    workspace.manifest.version = version;
    for (const section of dependencySections) {
      const dependencies = workspace.manifest[section];
      if (!dependencies) continue;
      for (const name of Object.keys(dependencies)) {
        if (localNames.has(name)) dependencies[name] = version;
      }
    }
    writeJson(workspace.path, workspace.manifest);
  }
  return { version, workspacePaths: workspacePaths.map((path) => relative(root, path)) };
}

export function synchronizeCargoManifest(source, version) {
  const packagePattern = /(\[package\][\s\S]*?\nversion = ")[^"]+("\n)/;
  if (!packagePattern.test(source)) throw new Error("Cargo.toml must contain one package version");
  return source.replace(packagePattern, `$1${version}$2`);
}

export function synchronizeCargoLockVersion(lockfile, version) {
  const packagePattern = /(\[\[package\]\]\nname = "multaiplayer"\nversion = ")[^"]+("\n)/g;
  const matches = Array.from(lockfile.matchAll(packagePattern));
  if (matches.length !== 1) throw new Error(`expected one multaiplayer package in Cargo.lock, found ${matches.length}`);
  return lockfile.replace(packagePattern, `$1${version}$2`);
}

function main() {
  const root = process.cwd();
  const { version, workspacePaths } = synchronizeWorkspaceManifests(root);
  const cargoManifestPath = join(root, "apps/desktop/src-tauri/Cargo.toml");
  writeFileSync(cargoManifestPath, synchronizeCargoManifest(readFileSync(cargoManifestPath, "utf8"), version));
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
  const cargoLockPath = join(root, "apps/desktop/src-tauri/Cargo.lock");
  writeFileSync(cargoLockPath, synchronizeCargoLockVersion(readFileSync(cargoLockPath, "utf8"), version));
  console.log(
    `Synchronized ${workspacePaths.length} workspaces, npm lock metadata, and native metadata to ${version}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

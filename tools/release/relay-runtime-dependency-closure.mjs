#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [command, nodeModules = "node_modules", evidenceOrTreePath = "relay-runtime-dependencies.json", treePath] =
  process.argv.slice(2);
assert.ok(
  command === "check-tree" || command === "prune" || command === "verify",
  "command must be check-tree, prune, or verify"
);

if (command === "check-tree") {
  const tree = JSON.parse(readFileSync(evidenceOrTreePath, "utf8"));
  collectTreeClosure(tree, nodeModules);
  console.log("Verified that the locked relay npm tree has no unresolved required dependencies.");
} else if (command === "prune") {
  assert.ok(treePath, "prune requires an npm ls JSON path");
  const tree = JSON.parse(readFileSync(treePath, "utf8"));
  const declaredClosure = collectTreeClosure(tree, nodeModules);
  removeNpmMetadata(nodeModules);
  for (const installed of scanInstalledPackages(nodeModules)) {
    if (!declaredClosure.has(identity(installed)))
      rmSync(join(nodeModules, installed.path), { recursive: true, force: true });
  }
  const installedPackages = scanInstalledPackages(nodeModules);
  for (const installed of installedPackages) {
    assert.ok(declaredClosure.has(identity(installed)), `unexpected runtime package ${identity(installed)}`);
  }
  writeFileSync(
    evidenceOrTreePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        root: "@multaiplayer/relay",
        declaredClosure: [...declaredClosure].sort(),
        installedPackages
      },
      null,
      2
    )}\n`
  );
  console.log(`Pruned relay runtime to ${installedPackages.length} installed package locations.`);
} else {
  const evidence = JSON.parse(readFileSync(evidenceOrTreePath, "utf8"));
  assert.equal(evidence.schemaVersion, 1, "unsupported relay runtime dependency evidence");
  assert.equal(evidence.root, "@multaiplayer/relay", "unexpected relay runtime root");
  const installedPackages = scanInstalledPackages(nodeModules);
  assert.deepEqual(
    installedPackages,
    evidence.installedPackages,
    "runtime dependency locations differ from build evidence"
  );
  const declaredClosure = new Set(evidence.declaredClosure);
  assertNpmMetadataAbsent(nodeModules);
  for (const installed of installedPackages) {
    assert.ok(
      declaredClosure.has(identity(installed)),
      `runtime package is outside declared closure: ${identity(installed)}`
    );
  }
  console.log(
    `Verified ${installedPackages.length} relay runtime package locations against generated closure evidence.`
  );
}

function removeNpmMetadata(nodeModules) {
  if (!existsSync(nodeModules)) return;
  rmSync(join(nodeModules, ".bin"), { recursive: true, force: true });
  rmSync(join(nodeModules, ".package-lock.json"), { force: true });
  for (const installed of scanInstalledPackages(nodeModules)) {
    const nested = join(nodeModules, installed.path, "node_modules");
    if (existsSync(nested)) removeNpmMetadata(nested);
  }
}

function assertNpmMetadataAbsent(nodeModules) {
  if (!existsSync(nodeModules)) return;
  assert.equal(existsSync(join(nodeModules, ".bin")), false, `${nodeModules}/.bin must not be shipped`);
  assert.equal(
    existsSync(join(nodeModules, ".package-lock.json")),
    false,
    `${nodeModules}/.package-lock.json must not be shipped`
  );
  for (const installed of scanInstalledPackages(nodeModules)) {
    const nested = join(nodeModules, installed.path, "node_modules");
    if (existsSync(nested)) assertNpmMetadataAbsent(nested);
  }
}

function collectTreeClosure(tree, nodeModules) {
  const root = tree.dependencies?.["@multaiplayer/relay"];
  assert.ok(root, "npm dependency tree must contain @multaiplayer/relay");
  const installed = scanInstalledPackages(nodeModules);
  const closure = new Set();
  const visit = (name, entry, parent) => {
    if (typeof entry.version !== "string") {
      assert.ok(parent, `root dependency ${name} must have a resolved version`);
      assertOptionalPeer(parent, name, installed, nodeModules);
      return;
    }
    closure.add(`${name}@${entry.version}`);
    for (const [childName, child] of Object.entries(entry.dependencies ?? {})) {
      visit(childName, child, { name, version: entry.version });
    }
  };
  visit("@multaiplayer/relay", root, undefined);
  return closure;
}

function assertOptionalPeer(parent, dependencyName, installed, nodeModules) {
  const parentLocations = installed.filter(
    (candidate) => candidate.name === parent.name && candidate.version === parent.version
  );
  assert.ok(
    parentLocations.length > 0,
    `cannot verify unresolved dependency ${dependencyName}: ${parent.name}@${parent.version} is not installed`
  );
  for (const location of parentLocations) {
    const manifestPath = join(nodeModules, location.path, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(
      manifest.peerDependenciesMeta?.[dependencyName]?.optional,
      true,
      `dependency ${dependencyName} of ${parent.name}@${parent.version} is unresolved and is not a manifest-declared optional peer`
    );
    assert.equal(
      typeof manifest.peerDependencies?.[dependencyName],
      "string",
      `optional peer ${dependencyName} must be declared in ${manifestPath}`
    );
  }
}

function scanInstalledPackages(nodeModules) {
  if (!existsSync(nodeModules)) return [];
  const packages = [];
  const visitNodeModules = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry.startsWith(".")) continue;
      const entryPath = join(directory, entry);
      if (entry.startsWith("@")) {
        if (!lstatSync(entryPath).isDirectory()) continue;
        for (const scopedEntry of readdirSync(entryPath).sort()) visitPackage(join(entryPath, scopedEntry));
      } else {
        visitPackage(entryPath);
      }
    }
  };
  const visitPackage = (directory) => {
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(typeof manifest.name, "string", `${manifestPath} must declare a package name`);
    assert.equal(typeof manifest.version, "string", `${manifestPath} must declare a package version`);
    packages.push({ path: relative(nodeModules, directory), name: manifest.name, version: manifest.version });
    const nested = join(directory, "node_modules");
    if (existsSync(nested)) visitNodeModules(nested);
  };
  visitNodeModules(nodeModules);
  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

function identity({ name, version }) {
  return `${name}@${version}`;
}

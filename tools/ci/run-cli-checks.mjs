#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const cliRoot = resolve(root, "apps/cli");
const manifest = resolve(cliRoot, "Cargo.toml");
const lockfile = resolve(cliRoot, "Cargo.lock");
const npmManifest = resolve(cliRoot, "package.json");

assert.equal(
  existsSync(npmManifest),
  false,
  "apps/cli/package.json would couple the CLI to desktop npm release metadata"
);

for (const path of [
  ".github/workflows/release.yml",
  "docs/release-assets.v1.json",
  "scripts/check-release-versions.mjs",
  "tools/release/sync-release-metadata.mjs"
]) {
  const source = readFileSync(resolve(root, path), "utf8");
  assert.equal(source.includes("apps/cli"), false, `${path} must not include unfinished CLI packaging`);
}

if (!existsSync(manifest)) {
  assert.equal(existsSync(cliRoot), false, "apps/cli exists without its required standalone Cargo.toml");
  console.log("CLI release isolation verified; the standalone Rust workspace has not been scaffolded yet.");
  process.exit(0);
}

assert.equal(existsSync(lockfile), true, "apps/cli must retain its independent Cargo.lock");

{
  const result = spawnSync(process.execPath, ["--test", "apps/cli/release/release-policy.test.mjs"], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "CLI release policy tests failed");
}

{
  const result = spawnSync("npm", ["run", "build:packages"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "npm run build:packages failed");
}

for (const [command, args] of [
  ["cargo", ["fmt", "--manifest-path", manifest, "--all", "--", "--check"]],
  [
    "cargo",
    [
      "clippy",
      "--locked",
      "--manifest-path",
      manifest,
      "--workspace",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings"
    ]
  ],
  ["cargo", ["test", "--locked", "--manifest-path", manifest, "--workspace", "--all-features"]]
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

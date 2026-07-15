#!/usr/bin/env node

// Release tooling lives outside scripts/ so the operator-facing script surface
// stays intentionally small.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? "0";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "multaiplayer-relay-repro-"));
const firstIid = join(temporaryDirectory, "first.iid");
const secondIid = join(temporaryDirectory, "second.iid");

try {
  build("multaiplayer-relay:repro-a", firstIid);
  build("multaiplayer-relay:repro-b", secondIid);
  const first = inspect("multaiplayer-relay:repro-a");
  const second = inspect("multaiplayer-relay:repro-b");
  assert.deepEqual(second, first, "independent relay builds produced different image configuration or layers");
  console.log(`Relay container reproduced exactly: ${first.id}`);
} finally {
  run("docker", ["image", "rm", "--force", "multaiplayer-relay:repro-a", "multaiplayer-relay:repro-b"], false);
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function build(tag, iidfile) {
  run("docker", [
    "build",
    "--no-cache",
    "--file",
    "apps/relay/Dockerfile",
    "--build-arg",
    `SOURCE_DATE_EPOCH=${sourceDateEpoch}`,
    "--iidfile",
    iidfile,
    "--tag",
    tag,
    "."
  ]);
}

function inspect(tag) {
  const output = run("docker", ["image", "inspect", tag]);
  const [image] = JSON.parse(output);
  return {
    id: image.Id,
    architecture: image.Architecture,
    os: image.Os,
    config: image.Config,
    rootfs: image.RootFS
  };
}

function run(command, args, required = true) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (required && result.status !== 0) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown process failure";
    throw new Error(`${command} ${args.join(" ")} failed:\n${detail}`);
  }
  return result.stdout;
}

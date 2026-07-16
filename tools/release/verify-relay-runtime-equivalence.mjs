#!/usr/bin/env node

// Release tooling lives outside scripts/ so the operator-facing script surface
// stays intentionally small.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeExcludedPaths } from "./relay-runtime-filesystem-manifest.mjs";

export function normalizeRuntimeConfig(image) {
  return sortObject({
    architecture: image.Architecture,
    config: image.Config,
    os: image.Os
  });
}

export function digestProof(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function runtimeWalkerArguments(tag) {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--no-healthcheck",
    "--read-only",
    "--user",
    "0:0",
    "--entrypoint",
    "node",
    tag,
    "--input-type=module",
    "-",
    "--walk-root"
  ];
}

async function main() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? "0";
  const suffix = `${process.pid}-${Date.now()}`;
  const firstTag = `multaiplayer-relay:runtime-equivalence-a-${suffix}`;
  const secondTag = `multaiplayer-relay:runtime-equivalence-b-${suffix}`;

  try {
    build(firstTag, sourceDateEpoch);
    build(secondTag, sourceDateEpoch);

    const first = await collectProof(firstTag);
    const second = await collectProof(secondTag);
    assertEquivalent("stable runtime configuration", first.config, second.config);
    assertEquivalent("normalized runtime filesystem", first.manifest, second.manifest);

    console.log("Relay normalized runtime-equivalence proof passed for two independent no-cache builds.");
    console.log(`Stable runtime configuration SHA-256: ${digestProof(first.config)}`);
    console.log(
      `Normalized runtime filesystem SHA-256: ${digestProof(first.manifest)} (${first.manifest.length} paths)`
    );
    console.log(`Excluded runtime paths: ${[...runtimeExcludedPaths].sort().join(", ")}`);
    console.log(
      "Scope: same build platform and Docker/BuildKit implementation; image and layer bytes are not compared."
    );
  } finally {
    run("docker", ["image", "rm", "--force", firstTag, secondTag], { required: false });
  }
}

function build(tag, sourceDateEpoch) {
  run("docker", [
    "build",
    "--no-cache",
    "--file",
    "apps/relay/Dockerfile",
    "--build-arg",
    `SOURCE_DATE_EPOCH=${sourceDateEpoch}`,
    "--tag",
    tag,
    "."
  ]);
}

async function collectProof(tag) {
  const walkerSource = await readFile(new URL("./relay-runtime-filesystem-manifest.mjs", import.meta.url), "utf8");
  const manifest = JSON.parse(run("docker", runtimeWalkerArguments(tag), { input: walkerSource }));
  const [image] = JSON.parse(run("docker", ["image", "inspect", tag]));
  return { config: normalizeRuntimeConfig(image), manifest };
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])])
    );
  }
  return value;
}

function assertEquivalent(label, first, second) {
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      `Independent relay builds produced different ${label}.\n` +
        `First SHA-256:  ${digestProof(first)}\nSecond SHA-256: ${digestProof(second)}\n` +
        `First difference: ${describeFirstDifference(first, second)}`
    );
  }
}

function describeFirstDifference(first, second) {
  if (Array.isArray(first) && Array.isArray(second)) {
    const length = Math.max(first.length, second.length);
    for (let index = 0; index < length; index += 1) {
      if (JSON.stringify(first[index]) !== JSON.stringify(second[index])) {
        return `entry ${index}: ${JSON.stringify(first[index])} != ${JSON.stringify(second[index])}`;
      }
    }
  }
  return `${JSON.stringify(first).slice(0, 1_000)} != ${JSON.stringify(second).slice(0, 1_000)}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
  if ((options.required ?? true) && result.status !== 0) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown process failure";
    throw new Error(`${command} ${args.join(" ")} failed:\n${detail}`);
  }
  return result.stdout;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}

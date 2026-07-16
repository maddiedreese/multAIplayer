#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(version) {
  const match = semverPattern.exec(version);
  assert.ok(match, `updater version is not strict SemVer: ${version}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? []
  };
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function assertChannelDoesNotRegress(candidate, current) {
  assert.equal(typeof candidate.version, "string", "candidate updater manifest has no version");
  assert.equal(typeof current.version, "string", "current updater manifest has no version");
  const order = compareSemver(candidate.version, current.version);
  assert.ok(order >= 0, `refusing updater channel regression from ${current.version} to ${candidate.version}`);
  if (order === 0) {
    assert.deepEqual(
      candidate,
      current,
      `updater manifest at SemVer ${candidate.version} may only be retried byte-for-byte`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [candidatePath, currentPath] = process.argv.slice(2);
  assert.ok(candidatePath && currentPath, "expected candidate and current updater manifests");
  assertChannelDoesNotRegress(
    JSON.parse(readFileSync(candidatePath, "utf8")),
    JSON.parse(readFileSync(currentPath, "utf8"))
  );
  console.log("Updater channel candidate does not regress the published SemVer.");
}

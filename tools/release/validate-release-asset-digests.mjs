#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export function validateReleaseAssetDigests(directory, releaseJson, expectedNames) {
  const assets = Array.isArray(releaseJson) ? releaseJson : releaseJson.assets;
  assert.ok(Array.isArray(assets), "GitHub release metadata must contain an assets array");
  const selectedNames = expectedNames ? new Set(expectedNames) : undefined;
  if (selectedNames) {
    assert.equal(selectedNames.size, expectedNames.length, "expected release asset names must be unique");
  }
  const seen = new Set();
  for (const asset of assets) {
    assert.equal(typeof asset.name, "string", "release asset name is missing");
    assert.equal(seen.has(asset.name), false, `duplicate release asset metadata for ${asset.name}`);
    seen.add(asset.name);
    if (selectedNames && !selectedNames.has(asset.name)) continue;
    assert.match(asset.digest ?? "", /^sha256:[0-9a-f]{64}$/, `GitHub digest is unavailable for ${asset.name}`);
    const bytes = readFileSync(join(directory, basename(asset.name)));
    const localDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(asset.digest, localDigest, `published digest does not match downloaded bytes for ${asset.name}`);
  }
  if (selectedNames) {
    for (const name of selectedNames) assert.ok(seen.has(name), `GitHub release metadata is missing ${name}`);
    return [...selectedNames].sort();
  }
  return [...seen].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, metadataPath, namesPath, expectedNamesPath] = process.argv.slice(2);
  assert.ok(directory && metadataPath && namesPath, "expected asset directory, release metadata, and names output");
  const expectedNames = expectedNamesPath
    ? readFileSync(expectedNamesPath, "utf8").split(/\r?\n/).filter(Boolean)
    : undefined;
  const names = validateReleaseAssetDigests(directory, JSON.parse(readFileSync(metadataPath, "utf8")), expectedNames);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(namesPath, `${names.join("\n")}\n`);
  console.log(`Verified ${names.length} GitHub release asset digests against downloaded bytes.`);
}

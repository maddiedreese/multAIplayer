#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const phase = process.argv[2];
const source = process.argv[3] ?? "release-assets";
assert.ok(
  phase === "build" || phase === "published" || phase === "published-list",
  "phase must be build, published, or published-list"
);
const contract = JSON.parse(readFileSync("docs/release-assets.v1.json", "utf8"));
const releaseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
assert.equal(contract.schemaVersion, 1, "unsupported release asset contract");
const names =
  phase === "published-list"
    ? readFileSync(source, "utf8").split(/\r?\n/).filter(Boolean).sort()
    : readdirSync(source).sort();
const exactNames = phase === "build" ? contract.buildOutputExactNames : contract.requiredExactNames;
const matchedPatternNames = [];

for (const name of exactNames) {
  assert.equal(names.filter((candidate) => candidate === name).length, 1, `expected exactly one ${name}`);
}
for (const pattern of contract.requiredNamePatterns) {
  const expression = new RegExp(pattern);
  const matches = names.filter((name) => expression.test(name));
  assert.equal(matches.length, 1, `expected exactly one asset matching ${pattern}`);
  matchedPatternNames.push(...matches);
}

const dmgNames = names.filter((name) => /^multAIplayer_[0-9A-Za-z.+-]+_aarch64\.dmg$/.test(name));
assert.deepEqual(
  dmgNames,
  [`multAIplayer_${releaseVersion}_aarch64.dmg`],
  "release DMG name must match the checked-out package version"
);

const expectedNames = [...exactNames, ...matchedPatternNames].sort();
assert.deepEqual(names, expectedNames, "release assets must contain only the canonical exact asset set");

console.log(`${phase} assets exactly satisfy release-assets.v${contract.schemaVersion}.json.`);

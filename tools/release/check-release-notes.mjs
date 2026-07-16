#!/usr/bin/env node

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "CHANGELOG.md";
const changelog = readFileSync(path, "utf8");
const releaseHeading = /^## \[(?!Unreleased\])[^\]]+\].*$/m.exec(changelog);
const nextHeadingIndex = releaseHeading
  ? changelog.indexOf("\n## [", releaseHeading.index + releaseHeading[0].length)
  : -1;
const firstRelease = releaseHeading
  ? changelog.slice(releaseHeading.index, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)
  : undefined;

if (!firstRelease) {
  console.log("No generated release section exists yet; the curated Unreleased section remains authoritative.");
  process.exit(0);
}

const descriptions = firstRelease
  .split("\n")
  .filter((line) => line.startsWith("* ") || line.startsWith("- "))
  .map((line) =>
    line
      .slice(2)
      .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/i, "")
      .replace(/\s*\(#[0-9]+\)\s*$/, "")
      .trim()
      .toLocaleLowerCase("en-US")
  );
const duplicates = [
  ...new Set(descriptions.filter((description, index) => descriptions.indexOf(description) !== index))
];
if (duplicates.length > 0) {
  console.error(`Generated release notes contain duplicate entries:\n- ${duplicates.join("\n- ")}`);
  process.exit(1);
}

console.log(`Checked ${descriptions.length} entries in the newest generated release section; no duplicates found.`);

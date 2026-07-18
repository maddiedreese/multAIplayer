import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGoldenFixtureFile } from "./golden-fixtures.js";

const output = resolve(import.meta.dirname, "../fixtures/golden-v1.json");
const rendered = renderGoldenFixtureFile();
if (process.argv[2] === "--write") writeFileSync(output, rendered, "utf8");
else if (process.argv[2] === "--check") assert.equal(readFileSync(output, "utf8"), rendered);
else throw new Error("Usage: tsx test/export-golden-fixtures.ts --check|--write");

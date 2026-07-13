#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";

const [label, reportPath] = process.argv.slice(2);
if (!label || !reportPath) throw new Error("usage: write-mutation-step-summary.mjs <label> <summary.json>");
if (!process.env.GITHUB_STEP_SUMMARY) throw new Error("GITHUB_STEP_SUMMARY is not configured");

const report = JSON.parse(await readFile(reportPath, "utf8"));
const totals = report?.totals;
if (!totals || typeof totals !== "object") throw new Error("mutation summary has no totals");
const score = totals.mutationScore === null ? "n/a" : `${totals.mutationScore}%`;
await appendFile(
  process.env.GITHUB_STEP_SUMMARY,
  `## ${label}\n\n| Score | Detected | Survived | No coverage | Total |\n| ---: | ---: | ---: | ---: | ---: |\n| ${score} | ${totals.detected} | ${totals.survived} | ${totals.noCoverage} | ${totals.total} |\n`,
  "utf8"
);

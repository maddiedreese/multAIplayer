#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const startMarker = "<!-- BEGIN GENERATED SECURITY JOURNEY EVIDENCE -->";
const endMarker = "<!-- END GENERATED SECURITY JOURNEY EVIDENCE -->";

function validatedClaims(manifest) {
  if (
    !manifest ||
    manifest.formatVersion !== 1 ||
    manifest.journey !== "relay-process-security" ||
    manifest.result !== "passed" ||
    !Array.isArray(manifest.claims) ||
    manifest.claims.length === 0
  ) {
    throw new TypeError("security journey claims manifest is malformed or does not record a passing run");
  }
  const ids = new Set();
  return manifest.claims.map((claim) => {
    if (
      !claim ||
      typeof claim.id !== "string" ||
      !/^[a-z][a-z0-9-]+$/.test(claim.id) ||
      typeof claim.claim !== "string" ||
      claim.claim.trim() === "" ||
      typeof claim.verification !== "string" ||
      claim.verification.trim() === "" ||
      !Array.isArray(claim.checks) ||
      claim.checks.length === 0 ||
      claim.checks.some((check) => typeof check !== "string" || check.trim() === "")
    ) {
      throw new TypeError("security journey claims manifest contains an invalid claim");
    }
    if (ids.has(claim.id)) throw new TypeError(`security journey claim id is duplicated: ${claim.id}`);
    ids.add(claim.id);
    return claim;
  });
}

function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderSecurityJourneyEvidence(manifest) {
  const claims = validatedClaims(manifest);
  const rows = claims.map(({ id, claim, verification, checks }) => [
    `\`${escapeCell(id)}\``,
    escapeCell(claim),
    `${escapeCell(verification)} Checks: ${checks.map((check) => `\`${escapeCell(check)}\``).join(", ")}.`
  ]);
  const table = markdownTable(["Journey claim ID", "Tested property", "Executed verification"], rows);
  return [startMarker, "", table, "", endMarker].join("\n");
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0), 3)
  );
  const renderRow = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [renderRow(headers), renderRow(widths.map((width) => "-".repeat(width))), ...rows.map(renderRow)].join("\n");
}

function replaceGeneratedSection(document, rendered) {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("threat model is missing the generated security-journey evidence markers");
  }
  const afterEnd = end + endMarker.length;
  if (
    document.indexOf(startMarker, start + startMarker.length) !== -1 ||
    document.indexOf(endMarker, afterEnd) !== -1
  ) {
    throw new Error("threat model contains duplicate generated security-journey evidence markers");
  }
  return `${document.slice(0, start)}${rendered}${document.slice(afterEnd)}`;
}

async function load(manifestPath, documentPath) {
  const [manifestText, document] = await Promise.all([readFile(manifestPath, "utf8"), readFile(documentPath, "utf8")]);
  return { manifest: JSON.parse(manifestText), document };
}

async function writeCommand([manifestPath, documentPath]) {
  if (!manifestPath || !documentPath) {
    throw new Error("usage: security-journey-evidence <write|check> <claims.json> <threat-model.md>");
  }
  const { manifest, document } = await load(manifestPath, documentPath);
  await writeFile(documentPath, replaceGeneratedSection(document, renderSecurityJourneyEvidence(manifest)), "utf8");
}

async function checkCommand([manifestPath, documentPath]) {
  if (!manifestPath || !documentPath) {
    throw new Error("usage: security-journey-evidence <write|check> <claims.json> <threat-model.md>");
  }
  const { manifest, document } = await load(manifestPath, documentPath);
  const expected = replaceGeneratedSection(document, renderSecurityJourneyEvidence(manifest));
  if (expected !== document) {
    throw new Error(
      `threat-model security evidence has drifted from the executed journey manifest; run: node tools/security/security-journey-evidence.mjs write ${manifestPath} ${documentPath}`
    );
  }
  process.stdout.write("Threat-model evidence matches the executed security journey.\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "write") await writeCommand(args);
  else if (command === "check") await checkCommand(args);
  else {
    console.error("usage: security-journey-evidence <write|check> <claims.json> <threat-model.md>");
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const domains = ["documentation", "workflow", "javascript", "native", "ui_journey", "native_journey", "macos"];

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

export function classifyChanges(paths) {
  const files = [...new Set(paths.filter(Boolean))];
  const executableFiles = files.filter((path) => !path.endsWith(".md"));
  const documentation = files.some((path) =>
    matches(path, [
      /\.md$/,
      /^\.github\/ISSUE_TEMPLATE\/.*\.ya?ml$/,
      /^scripts\/check-maintained-docs\.mjs$/,
      /^scripts\/check-repository-content\.mjs$/,
      /^contracts\/codex-app-server\/support-policy\.json$/,
      /^apps\/desktop\/src-tauri\/updater-public\.key$/,
      /^apps\/desktop\/src-tauri\/src\/lib\.rs$/,
      /^\.github\/workflows\/ci\.yml$/
    ])
  );
  const workflow = executableFiles.some((path) =>
    matches(path, [/^\.github\/(?:actions|workflows)\//, /^\.github\/codeql-config\.yml$/])
  );
  const native = executableFiles.some((path) =>
    matches(path, [
      /^apps\/desktop\/src-tauri\//,
      /^contracts\//,
      /^rust-toolchain\.toml$/,
      /^scripts\/verify-macos-deployment-target\.sh$/,
      /^\.github\/workflows\/ci\.yml$/,
      /^\.github\/actions\/setup-rust\//
    ])
  );
  const javascript = executableFiles.some((path) =>
    matches(path, [
      /^apps\/(?!desktop\/src-tauri\/)/,
      /^contracts\//,
      /^packages\//,
      /^e2e\//,
      /^scripts\/.*\.mjs$/,
      /^tools\//,
      /^package(?:-lock)?\.json$/,
      /^\.npmrc$/,
      /^\.prettierrc\.json$/,
      /^\.trivyignore\.yaml$/,
      /^railway\.json$/,
      /^\.github\/workflows\/ci\.yml$/,
      /^\.github\/actions\/(?:changed-domains|setup-node-npm)\//,
      /^eslint\.config\.mjs$/,
      /^tsconfig[^/]*\.json$/,
      /^\.prettierignore$/
    ])
  );
  const uiJourney = executableFiles.some((path) =>
    matches(path, [
      /^apps\/desktop\/(?!src-tauri\/)/,
      /^apps\/relay\//,
      /^packages\//,
      /^e2e\/(?!native-shell\/|native-macos\/)/,
      /^scripts\/run-e2e\.mjs$/,
      /^package(?:-lock)?\.json$/,
      /^\.npmrc$/,
      /^\.github\/workflows\/journeys\.yml$/,
      /^\.github\/actions\/setup-node-npm\//
    ])
  );
  const nativeJourney = executableFiles.some((path) =>
    matches(path, [
      /^apps\/desktop\/src-tauri\//,
      /^apps\/desktop\/(?:package\.json|native-command-error-codes\.json)$/,
      /^apps\/relay\//,
      /^packages\//,
      /^e2e\/native-shell\//,
      /^package(?:-lock)?\.json$/,
      /^\.npmrc$/,
      /^rust-toolchain\.toml$/,
      /^\.github\/workflows\/journeys\.yml$/,
      /^\.github\/actions\/setup-(?:node-npm|rust)\//
    ])
  );
  const macos = executableFiles.some((path) =>
    matches(path, [
      /^apps\/desktop\/src-tauri\//,
      /^apps\/desktop\/(?:package\.json|native-command-error-codes\.json|vite\.config\.ts)$/,
      /^packages\//,
      /^e2e\/native-macos\//,
      /^scripts\/verify-macos-/,
      /^package(?:-lock)?\.json$/,
      /^\.npmrc$/,
      /^rust-toolchain\.toml$/,
      /^\.github\/workflows\/journeys\.yml$/,
      /^\.github\/actions\/setup-(?:node-npm|rust)\//
    ])
  );

  return {
    documentation,
    workflow,
    javascript,
    native,
    ui_journey: uiJourney,
    native_journey: nativeJourney,
    macos
  };
}

export function allDomains() {
  return Object.fromEntries(domains.map((domain) => [domain, true]));
}

function writeOutputs(outputPath, classification) {
  assert.ok(outputPath, "GITHUB_OUTPUT path is required");
  const output = domains.map((domain) => `${domain}=${classification[domain]}`).join("\n");
  appendFileSync(outputPath, `${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outputFlag = args.indexOf("--github-output");
  const outputPath = outputFlag === -1 ? undefined : args[outputFlag + 1];
  const classification = args.includes("--all")
    ? allDomains()
    : classifyChanges(readFileSync(0, "utf8").split(/\r?\n/));
  if (outputPath) writeOutputs(outputPath, classification);
  else console.log(JSON.stringify(classification));
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const domains = [
  "documentation",
  "workflow",
  "javascript",
  "native",
  "ui_journey",
  "native_journey",
  "macos",
  "cli",
  "desktop",
  "relay",
  "shared",
  "protected_release"
];

const protectedReleasePatterns = [
  /^\.github\/workflows\/release\.yml$/,
  /^apps\/desktop\/package\.json$/,
  /^apps\/desktop\/src-tauri\/Cargo\.(?:lock|toml)$/,
  /^apps\/desktop\/src-tauri\/(?:Entitlements\.plist|release\.provisionprofile|tauri(?:\.release)?\.conf\.json|updater-public\.key)$/,
  /^docs\/release-assets\.v1\.json$/,
  /^package(?:-lock)?\.json$/,
  /^scripts\/check-release-versions\.mjs$/,
  /^tools\/release\//
];

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

export function classifyChanges(paths) {
  const files = [...new Set(paths.filter(Boolean))];
  const executableFiles = files.filter((path) => !path.endsWith(".md"));
  const shared = executableFiles.some((path) =>
    matches(path, [
      /^apps\/desktop\/src-tauri\/crates\/mls-core\//,
      /^contracts\//,
      /^crates\//,
      /^packages\//,
      /^rust-toolchain\.toml$/,
      /^tools\/ci\/classify-changes(?:\.test)?\.mjs$/,
      /^tools\/ci\/release-isolation(?:\.test)?\.mjs$/,
      /^\.github\/workflows\/ci\.yml$/,
      /^\.github\/actions\/changed-domains\//
    ])
  );
  const cli =
    shared ||
    executableFiles.some((path) => matches(path, [/^apps\/cli\//, /^e2e\/cli\//, /^tools\/ci\/run-cli-checks\.mjs$/]));
  const desktop =
    shared ||
    executableFiles.some((path) => matches(path, [/^apps\/desktop\//, /^e2e\/(?:native-macos|native-shell|ui)\//]));
  const relay = executableFiles.some((path) => matches(path, [/^apps\/relay\//, /^railway\.json$/]));
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
      /^crates\//,
      /^rust-toolchain\.toml$/,
      /^scripts\/verify-macos-deployment-target\.sh$/,
      /^\.github\/workflows\/ci\.yml$/,
      /^\.github\/actions\/setup-rust\//
    ])
  );
  const javascript = executableFiles.some((path) =>
    matches(path, [
      /^apps\/(?!cli\/|desktop\/src-tauri\/)/,
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
      /^apps\/relay\/src\/(?!manage-account-restriction\.ts$|observability\.ts$|predeploy-check\.ts$)/,
      /^packages\//,
      /^e2e\/(?!native-shell\/|native-macos\/)/,
      /^scripts\/run-ui-contract\.mjs$/,
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
      /^apps\/relay\/src\/(?!manage-account-restriction\.ts$|observability\.ts$|predeploy-check\.ts$)/,
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
      /^apps\/desktop\/(?:package\.json|vite\.config\.ts)$/,
      /^e2e\/native-macos\//,
      /^scripts\/verify-macos-/,
      /^package\.json$/,
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
    macos,
    cli,
    desktop,
    relay,
    shared,
    protected_release: protectedReleasePaths(files).length > 0
  };
}

export function protectedReleasePaths(paths) {
  return [...new Set(paths.filter((path) => path && matches(path, protectedReleasePatterns)))].sort();
}

export function allDomains() {
  return Object.fromEntries(domains.map((domain) => [domain, true]));
}

function writeOutputs(outputPath, classification) {
  assert.ok(outputPath, "GITHUB_OUTPUT path is required");
  const output = domains.map((domain) => `${domain}=${classification[domain]}`).join("\n");
  appendFileSync(outputPath, `${output}\n`);
}

function writeSummary(summaryPath, classification, protectedPaths, all) {
  if (!summaryPath) return;
  const selected = domains.filter((domain) => classification[domain]);
  const lines = [
    "## Changed-path classification",
    "",
    `Selected domains: ${selected.length > 0 ? selected.map((domain) => `\`${domain}\``).join(", ") : "none"}.`,
    ""
  ];
  if (all) {
    lines.push("No usable diff was available; all domains were selected conservatively.", "");
  } else if (protectedPaths.length > 0) {
    lines.push("### Protected desktop release paths", "", ...protectedPaths.map((path) => `- \`${path}\``), "");
  } else {
    lines.push("No protected desktop release path changed.", "");
  }
  appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outputFlag = args.indexOf("--github-output");
  const outputPath = outputFlag === -1 ? undefined : args[outputFlag + 1];
  const summaryFlag = args.indexOf("--github-summary");
  const summaryPath = summaryFlag === -1 ? undefined : args[summaryFlag + 1];
  const all = args.includes("--all");
  const paths = all ? [] : readFileSync(0, "utf8").split(/\r?\n/);
  const classification = all ? allDomains() : classifyChanges(paths);
  if (outputPath) writeOutputs(outputPath, classification);
  writeSummary(summaryPath, classification, protectedReleasePaths(paths), all);
  if (!outputPath) console.log(JSON.stringify(classification));
}

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const auditPath = new URL("../docs/tauri-ipc-boundary-audit.md", import.meta.url);
const registrationPath = new URL("../apps/desktop/src-tauri/src/lib.rs", import.meta.url);
const beginMarker = "<!-- BEGIN GENERATED IPC COMMANDS -->";
const endMarker = "<!-- END GENERATED IPC COMMANDS -->";

const registration = readFileSync(registrationPath, "utf8");
const declaration = registration.match(/declare_registered_commands!\s*\{([\s\S]*?)\n\}/)?.[1];
if (!declaration) throw new Error("Could not find declare_registered_commands! in apps/desktop/src-tauri/src/lib.rs");

const commandGroup = (name) => {
  const source = declaration.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (!source) throw new Error(`Could not find ${name} registered commands`);
  return source.match(/\b[a-z][a-z0-9_]*\b/g) ?? [];
};

const infallible = commandGroup("infallible");
const fallible = commandGroup("fallible");
const allCommands = [...infallible, ...fallible];
if (new Set(allCommands).size !== allCommands.length) throw new Error("Registered Tauri commands must be unique");

const generatedInventory = [
  beginMarker,
  "",
  `Generated from \`declare_registered_commands!\` in \`apps/desktop/src-tauri/src/lib.rs\`: ${allCommands.length} commands.`,
  "",
  "```text",
  ...allCommands.slice().sort(),
  "```",
  "",
  endMarker
].join("\n");

const audit = readFileSync(auditPath, "utf8");
const start = audit.indexOf(beginMarker);
const end = audit.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("IPC audit is missing generated inventory markers");
const currentInventory = audit.slice(start, end + endMarker.length);
if (process.argv.includes("--write-ipc-inventory")) {
  writeFileSync(auditPath, audit.replace(currentInventory, generatedInventory));
} else if (currentInventory !== generatedInventory) {
  throw new Error("IPC command inventory is stale; run `npm run docs:sync-ipc-inventory`");
}

const updaterKey = readFileSync(new URL("../apps/desktop/src-tauri/updater-public.key", import.meta.url));
const updaterFingerprint = createHash("sha256").update(updaterKey).digest("hex");
const releaseVerification = readFileSync(new URL("../docs/reproducible-builds.md", import.meta.url), "utf8");
if (!releaseVerification.includes(updaterFingerprint)) {
  throw new Error("docs/reproducible-builds.md does not contain the committed updater-key fingerprint");
}

const markdownFiles = ["README.md", ...walkMarkdown(new URL("../docs", import.meta.url).pathname)];
const fingerprintOwners = markdownFiles.filter((path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").includes(updaterFingerprint)
);
if (fingerprintOwners.join(",") !== "docs/reproducible-builds.md") {
  throw new Error(
    `Updater-key fingerprint must live only in docs/reproducible-builds.md; found: ${fingerprintOwners.join(", ")}`
  );
}

const policy = JSON.parse(
  readFileSync(new URL("../contracts/codex-app-server/support-policy.json", import.meta.url), "utf8")
);
const authoritativeCompatibilityDocs = new Set(["docs/codex-hosting.md", "docs/compatibility-inventory.md"]);
for (const path of markdownFiles) {
  if (authoritativeCompatibilityDocs.has(path)) continue;
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  if (source.includes(policy.minimumSupportedVersion) && source.includes(policy.latestContractTestedVersion)) {
    throw new Error(`Codex version bounds are duplicated in ${path}; link to docs/codex-hosting.md instead`);
  }
}
const codexHosting = readFileSync(new URL("../docs/codex-hosting.md", import.meta.url), "utf8");
if (
  !codexHosting.includes(policy.minimumSupportedVersion) ||
  !codexHosting.includes(policy.latestContractTestedVersion)
) {
  throw new Error("docs/codex-hosting.md is out of sync with the Codex support policy");
}

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative(root.pathname, path)] : [];
  });
}

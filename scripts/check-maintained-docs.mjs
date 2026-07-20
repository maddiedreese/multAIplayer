import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
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
for (const path of markdownFiles) {
  if (path === "docs/codex-hosting.md") continue;
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

const cliIndex = readFileSync(new URL("../docs/cli/README.md", import.meta.url), "utf8");
if (cliIndex.includes("intentionally not implemented")) {
  throw new Error("docs/cli/README.md still describes the implemented CLI as unimplemented");
}

const cliPlan = readFileSync(new URL("../docs/cli/development-plan.md", import.meta.url), "utf8");
if (/multAIplayer room join\s+<invite-code>/.test(cliPlan)) {
  throw new Error("CLI documentation must not place an invitation capability in a shell argument");
}

const cliGuide = readFileSync(new URL("../apps/cli/README.md", import.meta.url), "utf8");
for (const required of [
  "curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh",
  "multAIplayer room join",
  "## Compatibility and limitations",
  "## Update and uninstall"
]) {
  if (!cliGuide.includes(required)) throw new Error(`apps/cli/README.md is missing maintained guidance: ${required}`);
}
if (/multAIplayer room join\s+<invite-code>/.test(cliGuide)) {
  throw new Error("apps/cli/README.md must keep invitation capabilities out of shell arguments");
}

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative(root.pathname, path)] : [];
  });
}

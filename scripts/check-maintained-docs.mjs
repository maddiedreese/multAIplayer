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

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative(root.pathname, path)] : [];
  });
}

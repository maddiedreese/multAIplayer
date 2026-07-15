import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const changelogPath = "docs/threat-model.md";

const protectedPrefixes = [
  "apps/desktop/src-tauri/src/",
  "apps/desktop/src-tauri/crates/mls-core/src/",
  "apps/desktop/src/application/",
  "apps/desktop/src/lib/access/",
  "apps/desktop/src/lib/codex/",
  "apps/desktop/src/lib/handoff/",
  "apps/desktop/src/lib/history/",
  "apps/desktop/src/lib/invite/",
  "apps/desktop/src/lib/mls/",
  "apps/desktop/src/lib/platform/",
  "apps/desktop/src/lib/security/",
  "apps/desktop/src/lib/terminal/",
  "apps/relay/src/auth/",
  "apps/relay/src/http/",
  "apps/relay/src/persistence",
  "apps/relay/src/sqlite",
  "apps/relay/src/store-",
  "apps/relay/src/ws/",
  "packages/protocol/src/"
];

const protectedFiles = new Set([
  "README.md",
  "apps/desktop/src-tauri/capabilities/default.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/relay/src/authz.ts",
  "apps/relay/src/config.ts",
  "apps/relay/src/lifecycle.ts",
  "apps/relay/src/limits.ts",
  "apps/relay/src/opaque.ts",
  "apps/relay/src/relay-app.ts",
  "apps/relay/src/relay-domain.ts",
  "apps/relay/src/relay-route-adapter.ts",
  "apps/relay/src/relay-websocket-adapter.ts",
  "apps/relay/src/runtime-control.ts",
  "apps/relay/src/state.ts",
  "docs/alpha-limitations.md",
  "docs/cryptography.md",
  "docs/external-review-packet.md",
  "docs/protocol.md",
  "docs/engineering-practices.md",
  "docs/room-archives.md",
  "docs/self-hosting.md",
  "docs/threat-model.md"
]);

export function isSecurityClaimPath(path) {
  return protectedFiles.has(path) || protectedPrefixes.some((prefix) => path.startsWith(prefix));
}

export function hasDatedHistoryAddition(diff) {
  return /^\+### \d{4}-\d{2}-\d{2}\s*$/mu.test(diff);
}

export function threatModelChangelogViolation(paths, threatModelDiff = "") {
  const changed = new Set(paths.filter(Boolean));
  const protectedChange = [...changed].find(isSecurityClaimPath);
  if (protectedChange && changed.has(changelogPath) && hasDatedHistoryAddition(threatModelDiff)) return null;
  return protectedChange
    ? `${protectedChange} changes a documented security boundary; add a dated entry under ${changelogPath}#history in the same change`
    : null;
}

export function changedPaths(base, head, run = execFileSync) {
  const mergeBase = run("git", ["merge-base", base, head], { encoding: "utf8" }).trim();
  return run("git", ["diff", "--no-renames", "--name-only", "-z", mergeBase, head], { encoding: "utf8" }).split("\0");
}

export function threatModelDiff(base, head, run = execFileSync) {
  const mergeBase = run("git", ["merge-base", base, head], { encoding: "utf8" }).trim();
  return run("git", ["diff", "--unified=0", mergeBase, head, "--", changelogPath], { encoding: "utf8" });
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function main() {
  const base = option("--base") ?? process.env.BASE_SHA;
  const head = option("--head") ?? process.env.HEAD_SHA ?? "HEAD";
  if (!base) throw new Error("Provide --base <git-ref> or BASE_SHA to check security-claim changes.");
  const violation = threatModelChangelogViolation(changedPaths(base, head), threatModelDiff(base, head));
  if (violation) {
    console.error(violation);
    process.exitCode = 1;
    return;
  }
  console.log("Threat-model changelog contract passed.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

import { readFileSync } from "node:fs";

const policy = JSON.parse(
  readFileSync(new URL("../contracts/codex-app-server/support-policy.json", import.meta.url), "utf8")
);

export const minimumSupportedCodexVersion = policy.minimumSupportedVersion;
export const latestContractTestedCodexVersion = policy.latestContractTestedVersion;

export function assessCodexVersion(rawVersion) {
  const version = parseVersion(rawVersion);
  if (!version) return { status: "unknown", version: null };

  const minimum = parseVersion(minimumSupportedCodexVersion);
  const latest = parseVersion(latestContractTestedCodexVersion);
  if (compareVersions(version.parts, minimum.parts) < 0) {
    return { status: "unsupported_older", version: version.text };
  }
  if (compareVersions(version.parts, latest.parts) > 0) {
    return { status: "unverified_newer", version: version.text };
  }
  return { status: "supported", version: version.text };
}

function parseVersion(rawVersion) {
  if (!rawVersion) return null;
  const match = rawVersion.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:[-+\s]|$)/);
  if (!match) return null;
  return {
    text: `${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])]
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

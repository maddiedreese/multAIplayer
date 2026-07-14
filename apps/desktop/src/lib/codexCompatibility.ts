import supportPolicy from "../../../../contracts/codex-app-server/support-policy.json";

export const minimumSupportedCodexVersion = supportPolicy.minimumSupportedVersion;
export const latestContractTestedCodexVersion = supportPolicy.latestContractTestedVersion;

export type CodexCompatibilityStatus = "supported" | "unsupported_older" | "unverified_newer" | "unknown";

export interface CodexCompatibility {
  status: CodexCompatibilityStatus;
  version: string | null;
  message: string;
}

export function assessCodexCompatibility(rawVersion: string | null | undefined): CodexCompatibility {
  const version = parseCodexVersion(rawVersion);
  if (!version) {
    return {
      status: "unknown",
      version: null,
      message: "Codex version could not be matched to the app-server compatibility policy."
    };
  }
  const minimum = parseSemver(minimumSupportedCodexVersion)!;
  const latest = parseSemver(latestContractTestedCodexVersion)!;
  if (compareSemver(version.parts, minimum) < 0) {
    return {
      status: "unsupported_older",
      version: version.text,
      message: `Update Codex to ${minimumSupportedCodexVersion} or newer before hosting turns.`
    };
  }
  if (compareSemver(version.parts, latest) > 0) {
    return {
      status: "unverified_newer",
      version: version.text,
      message: `This Codex version is newer than the latest contract-tested version (${latestContractTestedCodexVersion}).`
    };
  }
  return {
    status: "supported",
    version: version.text,
    message: `Compatible with the tested app-server range ${minimumSupportedCodexVersion}–${latestContractTestedCodexVersion}.`
  };
}

export function formatCodexCompatibilitySummary(rawVersion: string | null | undefined): string {
  const compatibility = assessCodexCompatibility(rawVersion);
  const label = rawVersion?.trim() || compatibility.version || "Available";
  if (compatibility.status === "unsupported_older") return `${label} · update required`;
  if (compatibility.status === "unverified_newer") return `${label} · newer than tested`;
  if (compatibility.status === "unknown") return `${label} · compatibility unknown`;
  return label;
}

function parseCodexVersion(
  rawVersion: string | null | undefined
): { text: string; parts: [number, number, number] } | null {
  if (!rawVersion) return null;
  const match = rawVersion.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:[-+\s]|$)/);
  if (!match) return null;
  return {
    text: `${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])]
  };
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart !== undefined && rightPart !== undefined && leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

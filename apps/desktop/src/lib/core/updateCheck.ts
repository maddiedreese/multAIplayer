import { appVersion, updateManifestUrl } from "./appVersion";
import { reportExpectedFailure } from "./nonFatalReporting";

const officialReleaseOrigin = "https://github.com";
const officialReleasePathPrefix = "/maddiedreese/multAIplayer/releases/";
const maxVersionLength = 128;

interface ParsedSemVer {
  normalized: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export interface UpdateManifest {
  version: string;
  url: string;
  notes?: string;
  security?: boolean;
}

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  url: string;
  notes?: string;
  security: boolean;
}

export async function fetchUpdateNotice(
  manifestUrl = updateManifestUrl,
  currentVersion = appVersion,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateNotice | null> {
  const response = await fetchImpl(manifestUrl, {
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new Error(`Update check failed with HTTP ${response.status}`);
  const manifest = normalizeUpdateManifest(await response.json());
  if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) return null;
  return {
    currentVersion,
    latestVersion: manifest.version,
    url: manifest.url,
    notes: manifest.notes,
    security: manifest.security === true
  };
}

export function normalizeUpdateManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || typeof record.url !== "string") return null;
  const parsedVersion = parseSemVer(record.version);
  if (!parsedVersion) return null;
  const version = parsedVersion.normalized;
  const url = normalizeUpdateUrl(record.url, version);
  if (!url) return null;
  return {
    version,
    url,
    notes: typeof record.notes === "string" ? record.notes.slice(0, 240) : undefined,
    security: record.security === true
  };
}

export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseSemVer(left);
  const parsedRight = parseSemVer(right);
  if (!parsedLeft || !parsedRight) throw new Error("Update versions must be valid bounded SemVer values");
  for (const key of ["major", "minor", "patch"] as const) {
    const delta = parsedLeft[key] - parsedRight[key];
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    if (parsedLeft.prerelease.length === parsedRight.prerelease.length) return 0;
    return parsedLeft.prerelease.length === 0 ? 1 : -1;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemVer(value: string): ParsedSemVer | null {
  const version = value.trim().replace(/^v/, "");
  if (!version || version.length > maxVersionLength) return null;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version
    );
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return {
    normalized: version,
    major: core[0]!,
    minor: core[1]!,
    patch: core[2]!,
    prerelease
  };
}

function normalizeUpdateUrl(value: string, version: string): string | null {
  try {
    const parsed = new URL(value);
    const expectedPath = `${officialReleasePathPrefix}tag/v${version}`;
    if (
      parsed.origin !== officialReleaseOrigin ||
      parsed.username ||
      parsed.password ||
      decodeURIComponent(parsed.pathname) !== expectedPath
    )
      return null;
    return parsed.toString();
  } catch {
    reportExpectedFailure("update URL validation rejected malformed input");
    return null;
  }
}

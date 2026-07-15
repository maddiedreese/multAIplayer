import { reportExpectedFailure } from "./nonFatalReporting";

const maxVersionLength = 128;
const envelopeSchema = "multaiplayer-updater-envelope-v1";
const payloadSchema = "multaiplayer-updater-metadata-v1";

interface ParsedSemVer {
  normalized: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  url: string;
  notes?: string;
}

export function normalizeSignedUpdate(value: unknown): UpdateNotice | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || typeof record.currentVersion !== "string") return null;
  const latest = parseSemVer(record.version);
  const current = parseSemVer(record.currentVersion);
  if (!latest || !current || compareVersions(latest.normalized, current.normalized) <= 0) return null;
  const notes = normalizeAuthenticatedNotes(record.body, latest.normalized);
  if (!notes) return null;
  return {
    currentVersion: current.normalized,
    latestVersion: latest.normalized,
    url: `https://github.com/maddiedreese/multAIplayer/releases/tag/v${latest.normalized}`,
    notes
  };
}

function normalizeAuthenticatedNotes(value: unknown, version: string): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const envelope = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(envelope).sort().join(",") !== "payload,schema,signature" ||
      envelope.schema !== envelopeSchema ||
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    )
      return null;
    const payload = JSON.parse(envelope.payload) as Record<string, unknown>;
    if (
      Object.keys(payload).sort().join(",") !== "archiveSignature,notes,schema,url,version" ||
      payload.schema !== payloadSchema ||
      payload.version !== version ||
      typeof payload.archiveSignature !== "string" ||
      typeof payload.url !== "string" ||
      typeof payload.notes !== "string" ||
      payload.notes.length === 0 ||
      payload.notes.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(payload.notes)
    )
      return null;
    const expectedUrl = `https://github.com/maddiedreese/multAIplayer/releases/download/v${version}/multAIplayer-macos-arm64.app.tar.gz`;
    return payload.url === expectedUrl ? payload.notes : null;
  } catch {
    reportExpectedFailure("authenticated update notes rejected malformed metadata");
    return null;
  }
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

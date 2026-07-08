import { appVersion, updateManifestUrl } from "./appVersion";

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
  const version = record.version.trim();
  const url = normalizeUpdateUrl(record.url);
  if (!version || !url) return null;
  return {
    version,
    url,
    notes: typeof record.notes === "string" ? record.notes.slice(0, 240) : undefined,
    security: record.security === true
  };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function normalizeUpdateUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

import { PublicKeyFingerprint } from "@multaiplayer/protocol";
import { reportNonFatal } from "../core/nonFatalReporting";

/**
 * A device-scoped, room-local note that the user compared this fingerprint.
 * It is presentation state only: it grants no relay, MLS, or host authority.
 */
export interface DeviceFingerprintComparisonRecord {
  roomId: string;
  deviceId: string;
  fingerprint: string;
  comparedAt: string;
}

export interface DeviceFingerprintMarkdownInput {
  roomName: string;
  displayName: string;
  deviceId: string;
  fingerprint: string;
  comparedLocally: boolean;
}

const deviceFingerprintComparisonsStorageKey = "multaiplayer:device-fingerprint-comparisons:v1";
// Read this once for pre-alpha upgrades, then remove it. New writes must never
// recreate the old authorization-sounding storage boundary.
const legacyDeviceFingerprintComparisonsStorageKey = "multaiplayer:trusted-device-keys:v1";
const maxDeviceFingerprintComparisons = 500;

export function loadDeviceFingerprintComparisons(): DeviceFingerprintComparisonRecord[] {
  const stored = localStorage.getItem(deviceFingerprintComparisonsStorageKey);
  if (stored) {
    const current = parseStoredDeviceFingerprintComparisons(
      stored,
      "discard corrupt device-fingerprint comparison storage"
    );
    if (current) {
      localStorage.removeItem(legacyDeviceFingerprintComparisonsStorageKey);
      return current;
    }
    localStorage.removeItem(deviceFingerprintComparisonsStorageKey);
  }

  const legacy = localStorage.getItem(legacyDeviceFingerprintComparisonsStorageKey);
  if (!legacy) return [];
  const migrated = parseStoredDeviceFingerprintComparisons(
    legacy,
    "discard corrupt legacy device-fingerprint comparison storage"
  );
  if (!migrated) {
    localStorage.removeItem(legacyDeviceFingerprintComparisonsStorageKey);
    return [];
  }

  // Write-before-delete makes migration retryable if localStorage rejects the
  // new value (for example because storage is unavailable or full).
  localStorage.setItem(deviceFingerprintComparisonsStorageKey, JSON.stringify(migrated));
  localStorage.removeItem(legacyDeviceFingerprintComparisonsStorageKey);
  return migrated;
}

function parseStoredDeviceFingerprintComparisons(
  stored: string,
  failureOperation: string
): DeviceFingerprintComparisonRecord[] | null {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) throw new Error("fingerprint comparisons must be an array");
    return dedupeDeviceFingerprintComparisons(
      parsed.map(normalizeDeviceFingerprintComparison).filter(Boolean) as DeviceFingerprintComparisonRecord[]
    ).slice(-maxDeviceFingerprintComparisons);
  } catch {
    reportNonFatal(failureOperation);
    return null;
  }
}

export function recordDeviceFingerprintComparison(
  current: DeviceFingerprintComparisonRecord[],
  roomId: string,
  deviceId: string,
  fingerprint: string,
  comparedAt = new Date().toISOString()
): DeviceFingerprintComparisonRecord[] {
  const key = normalizeComparisonKey(roomId, deviceId, fingerprint);
  if (!key) return current;
  return persistDeviceFingerprintComparisons([
    ...current.filter((item) => item.roomId !== key.roomId || item.deviceId !== key.deviceId),
    {
      ...key,
      comparedAt
    }
  ]);
}

export function removeDeviceFingerprintComparison(
  current: DeviceFingerprintComparisonRecord[],
  roomId: string,
  deviceId: string
): DeviceFingerprintComparisonRecord[] {
  const normalizedRoomId = roomId.trim();
  const normalizedDeviceId = deviceId.trim();
  return persistDeviceFingerprintComparisons(
    current.filter((item) => item.roomId !== normalizedRoomId || item.deviceId !== normalizedDeviceId)
  );
}

export function isDeviceFingerprintCompared(
  current: DeviceFingerprintComparisonRecord[],
  roomId: string,
  deviceId: string,
  fingerprint?: string
): boolean {
  if (!fingerprint) return false;
  const key = normalizeComparisonKey(roomId, deviceId, fingerprint);
  if (!key) return false;
  return current.some(
    (item) => item.roomId === key.roomId && item.deviceId === key.deviceId && item.fingerprint === key.fingerprint
  );
}

export function buildDeviceFingerprintMarkdown(input: DeviceFingerprintMarkdownInput): string {
  return [
    `# Device fingerprint for ${input.displayName}`,
    "",
    `Room: ${input.roomName}`,
    `Device: ${input.deviceId}`,
    `Comparison note: ${input.comparedLocally ? "fingerprint compared on this device" : "not compared on this device"}`,
    "",
    "```text",
    input.fingerprint,
    "```",
    "",
    "This is an advisory note stored only on this device. Compare the fingerprint out of band before marking it compared. The note does not authenticate the person, grant access, or change MLS or relay authority."
  ].join("\n");
}

function persistDeviceFingerprintComparisons(
  keys: DeviceFingerprintComparisonRecord[]
): DeviceFingerprintComparisonRecord[] {
  const normalized = dedupeDeviceFingerprintComparisons(keys).slice(-maxDeviceFingerprintComparisons);
  localStorage.setItem(deviceFingerprintComparisonsStorageKey, JSON.stringify(normalized));
  localStorage.removeItem(legacyDeviceFingerprintComparisonsStorageKey);
  return normalized;
}

function dedupeDeviceFingerprintComparisons(
  keys: DeviceFingerprintComparisonRecord[]
): DeviceFingerprintComparisonRecord[] {
  const byRoomAndDevice = new Map<string, DeviceFingerprintComparisonRecord>();
  for (const key of keys) {
    byRoomAndDevice.set(`${key.roomId}\n${key.deviceId}`, key);
  }
  return Array.from(byRoomAndDevice.values());
}

function normalizeDeviceFingerprintComparison(value: unknown): DeviceFingerprintComparisonRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DeviceFingerprintComparisonRecord> & { trustedAt?: unknown };
  const key = normalizeComparisonKey(candidate.roomId, candidate.deviceId, candidate.fingerprint);
  const storedComparedAt = candidate.comparedAt ?? candidate.trustedAt;
  if (!key || typeof storedComparedAt !== "string") return null;
  const comparedAt = storedComparedAt.trim();
  if (!comparedAt || Number.isNaN(Date.parse(comparedAt))) return null;
  return {
    ...key,
    comparedAt
  };
}

function normalizeComparisonKey(
  roomId: unknown,
  deviceId: unknown,
  fingerprint: unknown
): Omit<DeviceFingerprintComparisonRecord, "comparedAt"> | null {
  if (typeof roomId !== "string" || typeof deviceId !== "string" || typeof fingerprint !== "string") {
    return null;
  }
  const normalizedRoomId = roomId.trim();
  const normalizedDeviceId = deviceId.trim();
  const parsedFingerprint = PublicKeyFingerprint.safeParse(fingerprint.trim());
  if (!normalizedRoomId || !normalizedDeviceId || !parsedFingerprint.success) return null;
  return {
    roomId: normalizedRoomId,
    deviceId: normalizedDeviceId,
    fingerprint: parsedFingerprint.data
  };
}

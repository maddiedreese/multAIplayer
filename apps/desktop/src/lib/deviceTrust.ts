export interface TrustedDeviceKey {
  roomId: string;
  deviceId: string;
  fingerprint: string;
  trustedAt: string;
}

export interface DeviceFingerprintMarkdownInput {
  roomName: string;
  displayName: string;
  deviceId: string;
  fingerprint: string;
  trusted: boolean;
}

const trustedDeviceKeysStorageKey = "multaiplayer:trusted-device-keys:v1";
const maxTrustedDeviceKeys = 500;

export function loadTrustedDeviceKeys(): TrustedDeviceKey[] {
  const stored = localStorage.getItem(trustedDeviceKeysStorageKey);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) throw new Error("trusted keys must be an array");
    return dedupeTrustedDeviceKeys(parsed.map(normalizeTrustedDeviceKey).filter(Boolean) as TrustedDeviceKey[]);
  } catch {
    localStorage.removeItem(trustedDeviceKeysStorageKey);
    return [];
  }
}

export function trustDeviceKey(
  current: TrustedDeviceKey[],
  roomId: string,
  deviceId: string,
  fingerprint: string,
  trustedAt = new Date().toISOString()
): TrustedDeviceKey[] {
  const key = normalizeTrustKey(roomId, deviceId, fingerprint);
  if (!key) return current;
  return persistTrustedDeviceKeys([
    ...current.filter((item) => item.roomId !== key.roomId || item.deviceId !== key.deviceId),
    {
      ...key,
      trustedAt
    }
  ]);
}

export function untrustDeviceKey(current: TrustedDeviceKey[], roomId: string, deviceId: string): TrustedDeviceKey[] {
  const normalizedRoomId = roomId.trim();
  const normalizedDeviceId = deviceId.trim();
  return persistTrustedDeviceKeys(
    current.filter((item) => item.roomId !== normalizedRoomId || item.deviceId !== normalizedDeviceId)
  );
}

export function isDeviceKeyTrusted(
  current: TrustedDeviceKey[],
  roomId: string,
  deviceId: string,
  fingerprint?: string
): boolean {
  if (!fingerprint) return false;
  const key = normalizeTrustKey(roomId, deviceId, fingerprint);
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
    `Trust status: ${input.trusted ? "locally trusted" : "not locally trusted"}`,
    "",
    "```text",
    input.fingerprint,
    "```",
    "",
    "This is a local device note. Compare the fingerprint out of band before marking it trusted."
  ].join("\n");
}

function persistTrustedDeviceKeys(keys: TrustedDeviceKey[]): TrustedDeviceKey[] {
  const normalized = dedupeTrustedDeviceKeys(keys).slice(-maxTrustedDeviceKeys);
  localStorage.setItem(trustedDeviceKeysStorageKey, JSON.stringify(normalized));
  return normalized;
}

function dedupeTrustedDeviceKeys(keys: TrustedDeviceKey[]): TrustedDeviceKey[] {
  const byRoomAndDevice = new Map<string, TrustedDeviceKey>();
  for (const key of keys) {
    byRoomAndDevice.set(`${key.roomId}\n${key.deviceId}`, key);
  }
  return Array.from(byRoomAndDevice.values());
}

function normalizeTrustedDeviceKey(value: unknown): TrustedDeviceKey | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TrustedDeviceKey>;
  const key = normalizeTrustKey(candidate.roomId, candidate.deviceId, candidate.fingerprint);
  if (!key || typeof candidate.trustedAt !== "string") return null;
  const trustedAt = candidate.trustedAt.trim();
  if (!trustedAt || Number.isNaN(Date.parse(trustedAt))) return null;
  return {
    ...key,
    trustedAt
  };
}

function normalizeTrustKey(
  roomId: unknown,
  deviceId: unknown,
  fingerprint: unknown
): Omit<TrustedDeviceKey, "trustedAt"> | null {
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
import { PublicKeyFingerprint } from "@multaiplayer/protocol";

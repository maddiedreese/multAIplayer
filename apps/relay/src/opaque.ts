export function isCanonicalPaddedBase64(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length < 4 || value.length > maxChars || /[\u0000-\u001f\u007f]/.test(value))
    return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64") === value;
}

export interface StrictDirectedInviteRequest {
  version: 2;
  binding: {
    version: 2;
    phase: "request";
    inviteId: string;
    teamId: string;
    roomId: string;
    keyEpoch: number;
    keyPackageHash: string;
    requestId: string;
    requestNonce: string;
    requesterUserId: string;
    requesterDeviceId: string;
    hostUserId: string;
    hostDeviceId: string;
    expiresAt: string;
    status: null;
    decidedAt: null;
  };
  sealedPayload: Record<string, unknown>;
}

export function parseStrictDirectedInviteRequestJson(
  value: unknown,
  maxChars: number
): StrictDirectedInviteRequest | null {
  if (typeof value !== "string" || value.length < 2 || value.length > maxChars || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!sameKeys(parsed, ["version", "binding", "sealedPayload"]) || parsed.version !== 2) return null;
    const binding = parsed.binding;
    const sealedPayload = parsed.sealedPayload;
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
    if (!sealedPayload || typeof sealedPayload !== "object" || Array.isArray(sealedPayload)) return null;
    const bindingRecord = binding as Record<string, unknown>;
    if (
      !sameKeys(bindingRecord, [
        "version",
        "phase",
        "inviteId",
        "teamId",
        "roomId",
        "keyEpoch",
        "keyPackageHash",
        "requestId",
        "requestNonce",
        "requesterUserId",
        "requesterDeviceId",
        "hostUserId",
        "hostDeviceId",
        "expiresAt",
        "status",
        "decidedAt"
      ]) ||
      bindingRecord.version !== 2 ||
      bindingRecord.phase !== "request" ||
      !boundedText(bindingRecord.inviteId, 160) ||
      !boundedRelayId(bindingRecord.teamId) ||
      !boundedRelayId(bindingRecord.roomId) ||
      !Number.isSafeInteger(bindingRecord.keyEpoch) ||
      Number(bindingRecord.keyEpoch) < 0 ||
      typeof bindingRecord.keyPackageHash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(bindingRecord.keyPackageHash) ||
      !boundedText(bindingRecord.requestId, 160) ||
      typeof bindingRecord.requestNonce !== "string" ||
      !/^[A-Za-z0-9_-]{16,160}$/.test(bindingRecord.requestNonce) ||
      !boundedText(bindingRecord.requesterUserId, 160) ||
      !boundedText(bindingRecord.requesterDeviceId, 160) ||
      !boundedText(bindingRecord.hostUserId, 160) ||
      !boundedText(bindingRecord.hostDeviceId, 160) ||
      typeof bindingRecord.expiresAt !== "string" ||
      Number.isNaN(Date.parse(bindingRecord.expiresAt)) ||
      bindingRecord.status !== null ||
      bindingRecord.decidedAt !== null ||
      !strictHpkeSealedObject(sealedPayload as Record<string, unknown>) ||
      JSON.stringify(parsed) !== value
    )
      return null;
    return parsed as unknown as StrictDirectedInviteRequest;
  } catch {
    return null;
  }
}

export function isStrictExporterCiphertextJson(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > maxChars || /[\u0000-\u001f\u007f]/.test(value))
    return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (!sameKeys(parsed, ["version", "epoch", "nonce", "ciphertext"])) return false;
    return (
      parsed.version === 1 &&
      Number.isSafeInteger(parsed.epoch) &&
      Number(parsed.epoch) >= 0 &&
      isCanonicalPaddedBase64(parsed.nonce, 64) &&
      isCanonicalPaddedBase64(parsed.ciphertext, maxChars) &&
      JSON.stringify(parsed) === value
    );
  } catch {
    return false;
  }
}

function byteArray(value: unknown, min: number, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
  );
}
function strictHpkeSealedObject(parsed: Record<string, unknown>): boolean {
  return (
    sameKeys(parsed, ["version", "kem_id", "kdf_id", "aead_id", "encapsulated_key", "ciphertext"]) &&
    parsed.version === 1 &&
    parsed.kem_id === 16 &&
    parsed.kdf_id === 1 &&
    parsed.aead_id === 1 &&
    byteArray(parsed.encapsulated_key, 65, 65) &&
    byteArray(parsed.ciphertext, 16, 1_000_000)
  );
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function boundedRelayId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value);
}
function sameKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

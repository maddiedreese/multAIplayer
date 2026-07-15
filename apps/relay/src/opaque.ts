export function isCanonicalPaddedBase64(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length < 4 || value.length > maxChars || /[\u0000-\u001f\u007f]/.test(value))
    return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64") === value;
}

export interface StrictDirectedInviteRequest {
  version: 3;
  binding: {
    version: 3;
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
    if (!isStrictInviteEnvelope(parsed)) return null;
    const bindingRecord = parsed.binding as Record<string, unknown>;
    if (!isStrictInviteBinding(bindingRecord)) return null;
    if (!strictHpkeSealedObject(parsed.sealedPayload as Record<string, unknown>)) return null;
    if (JSON.stringify(parsed) !== value) return null;
    return parsed as unknown as StrictDirectedInviteRequest;
  } catch {
    return null;
  }
}

const directedInviteBindingKeys = [
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
];

function isStrictInviteEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!sameKeys(record, ["version", "binding", "sealedPayload"]) || record.version !== 3) return false;
  return isPlainRecord(record.binding) && isPlainRecord(record.sealedPayload);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStrictInviteBinding(binding: Record<string, unknown>): boolean {
  if (!sameKeys(binding, directedInviteBindingKeys)) return false;
  if (binding.version !== 3 || binding.phase !== "request") return false;
  if (!boundedText(binding.inviteId, 160) || !boundedRelayId(binding.teamId) || !boundedRelayId(binding.roomId)) {
    return false;
  }
  if (!validInviteCryptographicBinding(binding)) return false;
  if (!validInviteParticipants(binding)) return false;
  return binding.status === null && binding.decidedAt === null;
}

function validInviteCryptographicBinding(binding: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(binding.keyEpoch) || Number(binding.keyEpoch) < 0) return false;
  if (typeof binding.keyPackageHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.keyPackageHash)) {
    return false;
  }
  if (!boundedText(binding.requestId, 160)) return false;
  return typeof binding.requestNonce === "string" && /^[A-Za-z0-9_-]{16,160}$/.test(binding.requestNonce);
}

function validInviteParticipants(binding: Record<string, unknown>): boolean {
  if (!boundedText(binding.requesterUserId, 160) || !boundedText(binding.requesterDeviceId, 160)) return false;
  if (!boundedText(binding.hostUserId, 160) || !boundedText(binding.hostDeviceId, 160)) return false;
  return typeof binding.expiresAt === "string" && !Number.isNaN(Date.parse(binding.expiresAt));
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

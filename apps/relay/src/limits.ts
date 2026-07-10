import {
  DevicePublicKeyJwk,
  defaultApprovalDelegationPolicy,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  codexReasoningEffortOptions,
  codexSpeedOptions,
  type RelayEnvelope,
  codexModelOptions,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type ApprovalDelegationPolicy,
  type CodexCatalogSelectionPolicy,
  type RoomRecord,
  type TeamRole
} from "@multaiplayer/protocol";

export interface RelayEnvelopeLimitOptions {
  encryptedEnvelopeMaxBytes: number;
  maxEnvelopeCiphertextChars: number;
  maxEnvelopeIdChars: number;
  maxEnvelopeNonceChars: number;
  maxDeviceIdChars: number;
  maxPublicKeyJwkChars: number;
  maxUserIdChars: number;
}

export interface EncryptedBacklogLimitOptions extends RelayEnvelopeLimitOptions {
  encryptedBacklogLimit: number;
  encryptedBacklogRetentionDays: number;
  now?: () => number;
}

export function normalizeMetadataText(value: unknown, maxChars: number): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

export function normalizeRelayId(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > maxChars) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

export function normalizeOptionalMetadataText(value: unknown, maxChars: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return normalizeMetadataText(text, maxChars);
}

export function isJsonStringifiableWithin(value: unknown, maxChars: number): boolean {
  try {
    return JSON.stringify(value).length <= maxChars;
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseIntegerValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function maxCiphertextCharactersForBlob(maxBytes: number): number {
  return Math.ceil((maxBytes + 1024) * 4 / 3) + 64;
}

export function isApprovalPolicy(value: string): value is RoomRecord["approvalPolicy"] {
  return [
    "ask_every_turn",
    "auto_chat_only",
    "auto_browser_allowed_sites",
    "never_host"
  ].includes(value);
}

export function isApprovalDelegationPolicy(value: string): value is ApprovalDelegationPolicy {
  return [
    defaultApprovalDelegationPolicy,
    "members_can_request",
    "members_can_approve",
    "trusted_members_only"
  ].includes(value as ApprovalDelegationPolicy);
}

export function isRoomMode(value: unknown): value is RoomRecord["mode"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["chat", "code", "workspace", "browser"].every((key) => typeof candidate[key] === "boolean");
}

export function normalizeDevicePublicKeyJwk(value: unknown, maxPublicKeyJwkChars: number): DevicePublicKeyJwkType | null {
  if (!isJsonStringifiableWithin(value, maxPublicKeyJwkChars)) return null;
  const parsed = DevicePublicKeyJwk.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeRoomProjectPath(value: unknown, maxRoomProjectPathChars: number): string | null {
  const projectPath = String(value ?? "").trim();
  if (!projectPath || projectPath.length > maxRoomProjectPathChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(projectPath)) return null;
  return projectPath;
}

export function normalizeCodexModel(value: unknown, maxCodexModelChars: number): string | null {
  const model = String(value ?? "").trim();
  if (!model || model.length > maxCodexModelChars) return null;
  if (codexModelOptions.some((option) => option.id === model)) return model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) return null;
  return model;
}

export function normalizeCodexReasoningEffort(value: unknown): RoomRecord["codexReasoningEffort"] | null {
  const effort = String(value ?? "").trim();
  return codexReasoningEffortOptions.some((option) => option.id === effort)
    ? effort as RoomRecord["codexReasoningEffort"]
    : null;
}

export function normalizeCodexSpeed(value: unknown): RoomRecord["codexSpeed"] | null {
  const speed = String(value ?? "").trim();
  return codexSpeedOptions.some((option) => option.id === speed)
    ? speed as RoomRecord["codexSpeed"]
    : null;
}

export function normalizeCodexCatalogSelectionPolicy(value: unknown): CodexCatalogSelectionPolicy | null {
  return value === "auto" || value === "pinned" ? value : null;
}

export function normalizeCodexReasoningEffortOrDefault(value: unknown): RoomRecord["codexReasoningEffort"] {
  return normalizeCodexReasoningEffort(value) ?? defaultCodexReasoningEffort;
}

export function normalizeCodexSpeedOrDefault(value: unknown): RoomRecord["codexSpeed"] {
  return normalizeCodexSpeed(value) ?? defaultCodexSpeed;
}

export function normalizeTeamRole(value: unknown): TeamRole {
  return value === "owner" || value === "admin" || value === "member" ? value : "member";
}

export function normalizeBrowserAllowedOrigins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const origins = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const raw = item.trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
      origins.add(parsed.origin);
    } catch {
      return null;
    }
  }
  return Array.from(origins);
}

export function isAllowedEnvelopePayload(envelope: RelayEnvelope): boolean {
  if (envelope.payload.algorithm === "AES-GCM-256") return true;
  return envelope.kind === "room.invite";
}

export function isRelayEnvelopeWithinLimits(envelope: RelayEnvelope, options: RelayEnvelopeLimitOptions): boolean {
  if (!normalizeMetadataText(envelope.id, options.maxEnvelopeIdChars)) return false;
  if (!normalizeMetadataText(envelope.senderUserId, options.maxUserIdChars)) return false;
  if (!normalizeMetadataText(envelope.senderDeviceId, options.maxDeviceIdChars)) return false;
  if (!normalizeMetadataText(envelope.payload.nonce, options.maxEnvelopeNonceChars)) return false;
  if (!envelope.payload.ciphertext || envelope.payload.ciphertext.length > options.maxEnvelopeCiphertextChars) return false;
  if (envelope.payload.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    if (!isJsonStringifiableWithin(envelope.payload.ephemeralPublicKeyJwk, options.maxPublicKeyJwkChars)) return false;
  }
  return Buffer.byteLength(JSON.stringify(envelope), "utf8") <= options.encryptedEnvelopeMaxBytes;
}

export function pruneEncryptedBacklog(envelopes: RelayEnvelope[], options: EncryptedBacklogLimitOptions): RelayEnvelope[] {
  const now = options.now ?? Date.now;
  const cutoffMs = now() - options.encryptedBacklogRetentionDays * 24 * 60 * 60 * 1000;
  return envelopes
    .filter((envelope) => {
      const createdAtMs = Date.parse(envelope.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= cutoffMs && isRelayEnvelopeWithinLimits(envelope, options);
    })
    .slice(-options.encryptedBacklogLimit);
}

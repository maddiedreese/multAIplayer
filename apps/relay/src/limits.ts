import {
  DevicePublicKeyJwk,
  codexModelOptions,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type RoomRecord,
  type TeamRole
} from "@multaiplayer/protocol";

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

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

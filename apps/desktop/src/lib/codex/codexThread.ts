export const maxCodexThreadIdChars = 200;

export function normalizeCodexThreadId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const threadId = value.trim();
  if (!threadId) return null;
  if (threadId.length > maxCodexThreadIdChars) return null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(threadId)) return null;
  return threadId;
}

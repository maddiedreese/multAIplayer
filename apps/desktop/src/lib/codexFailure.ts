export type CodexFailureKind = "usage_limit" | "auth" | "app_server_unavailable" | "unknown";

const usageLimitPatterns = [
  /\busage limit\b/i,
  /\brate limit\b/i,
  /\blimit reached\b/i,
  /\bquota\b/i,
  /\binsufficient quota\b/i,
  /\btoo many requests\b/i,
  /\b429\b/,
  /\btry again later\b/i,
  /\breset\b.*\b(limit|usage|quota)\b/i
];

const authPatterns = [
  /\bunauthorized\b/i,
  /\bnot authenticated\b/i,
  /\bsign in\b/i,
  /\blogin\b/i,
  /\b401\b/,
  /\b403\b/
];

const appServerPatterns = [
  /failed to start codex app-server/i,
  /could not open codex app-server/i,
  /codex app-server/i
];

export function classifyCodexFailure(parts: Array<string | null | undefined>): CodexFailureKind {
  const text = parts.filter(Boolean).join("\n");
  if (!text.trim()) return "unknown";
  if (usageLimitPatterns.some((pattern) => pattern.test(text))) return "usage_limit";
  if (authPatterns.some((pattern) => pattern.test(text))) return "auth";
  if (appServerPatterns.some((pattern) => pattern.test(text))) return "app_server_unavailable";
  return "unknown";
}

export function codexUsageLimitMessage(hostName: string): string {
  return `${hostName} is out of Codex usage. Another host can continue with the full room context.`;
}

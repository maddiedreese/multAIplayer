import { reportExpectedFailure } from "../core/nonFatalReporting";

const codexMentionPattern = /(^|[^\w@])@codex\b|^codex[,:-]\s*/i;
const codexAddressPattern = /(^|[^\w@])@codex\b[\s,:-]*|^codex[,:-]\s*/i;
const openBrowserPattern = /\bopen\s+([^\s]+)(?:\s|$)/i;

export function messageInvokesCodex(message: string): boolean {
  return codexMentionPattern.test(message);
}

export function extractCodexBrowserOpenUrl(message: string): string | null {
  const addressed = message.match(codexAddressPattern);
  if (!addressed) return null;
  const command = message.slice((addressed.index ?? 0) + addressed[0].length);
  const openMatch = command.match(openBrowserPattern);
  const rawTarget = openMatch?.[1]?.trim().replace(/[),.;!?]+$/, "");
  if (!rawTarget) return null;
  return normalizeBrowserCommandUrl(rawTarget);
}

export function normalizeBrowserCommandUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    reportExpectedFailure("Codex browser command URL validation rejected malformed input");
    return null;
  }
}

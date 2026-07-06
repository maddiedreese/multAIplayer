import { normalizeBrowserCommandUrl } from "./codexInvoke";

export function formatBrowserAccessLabel(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function normalizeBrowserLocationInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
  return normalizeBrowserCommandUrl(trimmed);
}

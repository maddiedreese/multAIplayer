import { reportExpectedFailure } from "./nonFatalReporting";

const githubAvatarHosts = new Set(["avatars.githubusercontent.com", "github.com", "githubusercontent.com"]);

export function trustedAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (githubAvatarHosts.has(host) || host.endsWith(".githubusercontent.com")) {
      return parsed.toString();
    }
  } catch {
    reportExpectedFailure("avatar URL validation rejected malformed input");
    return undefined;
  }
  return undefined;
}

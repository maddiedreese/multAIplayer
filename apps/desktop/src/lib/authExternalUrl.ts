import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./localBackend/runtime";
import { reportExpectedFailure } from "./nonFatalReporting";

const githubDeviceUrl = "https://github.com/login/device";
const openAiAuthHosts = new Set(["auth.openai.com", "chatgpt.com", "platform.openai.com"]);

/**
 * Authentication URLs cross a native-webview boundary. Keep this validation
 * centralized so a compromised relay or malformed Codex response cannot turn
 * an onboarding repair action into an arbitrary external navigation.
 */
export function trustedAuthenticationUrl(provider: "github" | "openai", value: string): string | null {
  if (value.length > 4_096) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (provider === "github") {
      if (`${parsed.origin}${parsed.pathname.replace(/\/$/, "")}` !== githubDeviceUrl || parsed.search || parsed.hash)
        return null;
    } else if (!openAiAuthHosts.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    return parsed.toString();
  } catch {
    reportExpectedFailure("rejected a malformed authentication URL");
    return null;
  }
}

export async function openTrustedAuthenticationUrl(provider: "github" | "openai", value: string): Promise<boolean> {
  const trusted = trustedAuthenticationUrl(provider, value);
  if (!trusted) return false;
  try {
    if (isTauriRuntime()) {
      await invoke<void>("open_trusted_authentication_url", { provider, url: trusted });
    } else {
      if (!window.open(trusted, "_blank", "noopener,noreferrer")) return false;
    }
    return true;
  } catch {
    reportExpectedFailure("system browser authentication open failed");
    return false;
  }
}

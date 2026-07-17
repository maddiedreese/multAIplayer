import { reportExpectedFailure } from "../core/nonFatalReporting";

export const localPreviewPorts = [3000, 3001, 5173, 5174, 8000, 8080, 4200, 5000, 8888] as const;

export const localPreviewHosts = ["localhost", "127.0.0.1"] as const;

export const quickTunnelDisclaimer =
  "Cloudflare is a third-party service. Use of Cloudflare Quick Tunnel is subject to Cloudflare's terms and policies.";

export const quickTunnelSafetyText = [
  "This will expose the selected local web app through a temporary public trycloudflare.com URL. Anyone with the link may be able to view it until you stop sharing.",
  "",
  "Do not share pages containing secrets, admin dashboards, private data, or local tools you do not intend others to access.",
  "",
  "Cloudflare is a third-party service. Tunnel traffic is routed through Cloudflare."
].join("\n");

export interface LocalPreviewCandidate {
  url: string;
  label: string;
}

export interface LocalPreviewShareState {
  id: string;
  sourceUrl: string;
  publicUrl?: string;
  status: "starting" | "live" | "stopped" | "error";
  message?: string;
}

export function normalizeLocalPreviewUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a local URL to share.");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    reportExpectedFailure("local preview URL validation rejected malformed input");
    throw new Error("Enter a valid local HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Local previews must use http:// or https://.");
  }

  if (!localPreviewHosts.includes(parsed.hostname as (typeof localPreviewHosts)[number])) {
    throw new Error("Local previews can only share localhost or 127.0.0.1 URLs.");
  }

  if (!parsed.port) {
    throw new Error("Include the local server port, for example http://localhost:3000.");
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Local preview port must be between 1 and 65535.");
  }

  parsed.hash = "";
  return parsed.toString();
}

export function localPreviewDetectionUrls(): string[] {
  return localPreviewPorts.flatMap((port) => localPreviewHosts.map((host) => `http://${host}:${port}/`));
}

export function localPreviewLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port}`;
  } catch {
    reportExpectedFailure("local preview label parser rejected malformed input");
    return url;
  }
}

export function isTryCloudflareUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && /^[a-zA-Z0-9.-]+\.trycloudflare\.com$/.test(parsed.hostname);
  } catch {
    reportExpectedFailure("quick-tunnel URL validation rejected malformed input");
    return false;
  }
}

export function localPreviewStatusLabel(status: LocalPreviewShareState["status"]): string {
  switch (status) {
    case "starting":
      return "Starting";
    case "live":
      return "Live";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
  }
}

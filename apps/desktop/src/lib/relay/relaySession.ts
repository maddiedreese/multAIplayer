import { getRelayHttpUrl } from "../core/appConfig";

const relaySessionHeader = "x-multaiplayer-session";
const relayWebSocketProtocol = "multaiplayer-v1";
const relayWebSocketSessionPrefix = "multaiplayer-session.";

let relaySession: string | null = null;
let relaySessionOrigin: string | null = null;

export function installRelaySession(value: string | null, origin?: string): void {
  if (value === null) {
    clearRelaySession();
    return;
  }
  if (value.length === 0 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    clearRelaySession();
    throw new Error("Native authentication returned an invalid relay session.");
  }
  const trustedOrigin = normalizeHttpOrigin(origin);
  if (!trustedOrigin || trustedOrigin !== new URL(getRelayHttpUrl()).origin) {
    clearRelaySession();
    throw new Error("Native authentication returned a relay session for an unexpected origin.");
  }
  relaySession = value;
  relaySessionOrigin = trustedOrigin;
}

export function clearRelaySession(): void {
  relaySession = null;
  relaySessionOrigin = null;
}

export async function relayFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const target = new URL(input.toString());
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Relay requests must use HTTP or HTTPS.");
  }
  if (relaySession && target.origin !== relaySessionOrigin) {
    throw new Error("Relay requests must use the authenticated relay origin.");
  }
  const headers = new Headers(init.headers);
  if (relaySession && target.origin === relaySessionOrigin) headers.set(relaySessionHeader, relaySession);
  return fetch(target, { ...init, headers, credentials: "include" });
}

export function relayWebSocketProtocols(url: string): string[] | undefined {
  if (!relaySession) return undefined;
  const target = new URL(url);
  const expectedProtocol = relaySessionOrigin?.startsWith("https:") ? "wss:" : "ws:";
  const expectedHost = relaySessionOrigin ? new URL(relaySessionOrigin).host : null;
  if (target.protocol !== expectedProtocol || target.host !== expectedHost) {
    throw new Error("Relay WebSocket must use the authenticated relay origin.");
  }
  return relaySession ? [relayWebSocketProtocol, `${relayWebSocketSessionPrefix}${relaySession}`] : undefined;
}

function normalizeHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.pathname === "/" && !url.search && !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

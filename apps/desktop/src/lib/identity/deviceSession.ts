import { signDeviceChallenge } from "../mls/mlsClient";
import { isRelayHttpErrorCode, readJsonResponse } from "../core/httpResponse";

export interface DeviceSession {
  token: string;
  expiresAt: string;
}

interface ScopedDeviceSession extends DeviceSession {
  scopeKey: string;
}

let currentSession: ScopedDeviceSession | null = null;
let activeScopeKey: string | null = null;
let establishmentGeneration = 0;
const renewals = new Map<string, Promise<DeviceSession>>();

export function clearDeviceSession(): void {
  currentSession = null;
  activeScopeKey = null;
  establishmentGeneration += 1;
  renewals.clear();
}

function deviceSessionScopeKey(relayHttpUrl: string, deviceId: string): string {
  return `${relayHttpUrl}\0${deviceId}`;
}

export function deviceSessionHeaders(): Record<string, string> {
  if (!currentSession) throw new Error("Device-authenticated relay session is unavailable.");
  return { "x-device-session": currentSession.token };
}

export async function establishDeviceSession(relayHttpUrl: string, deviceId: string): Promise<DeviceSession> {
  const scopeKey = deviceSessionScopeKey(relayHttpUrl, deviceId);
  activeScopeKey = scopeKey;
  if (currentSession?.scopeKey !== scopeKey) currentSession = null;
  if (currentSession && Date.parse(currentSession.expiresAt) > Date.now()) return currentSession;
  const existing = renewals.get(scopeKey);
  if (existing) return existing;
  const generation = ++establishmentGeneration;
  const establishment = establishDeviceSessionForScope(relayHttpUrl, deviceId, scopeKey, generation).finally(() => {
    if (renewals.get(scopeKey) === establishment) renewals.delete(scopeKey);
  });
  renewals.set(scopeKey, establishment);
  return establishment;
}

async function establishDeviceSessionForScope(
  relayHttpUrl: string,
  deviceId: string,
  scopeKey: string,
  generation: number
): Promise<DeviceSession> {
  const challengeResponse = await fetch(`${relayHttpUrl}/devices/${encodeURIComponent(deviceId)}/challenge`, {
    method: "POST",
    credentials: "include"
  });
  const challenge = await readJsonResponse<{ challenge: string; expiresAt: string }>(
    challengeResponse,
    "Failed to request device challenge"
  );
  const signed = await signDeviceChallenge(challenge.challenge);
  const sessionResponse = await fetch(`${relayHttpUrl}/devices/${encodeURIComponent(deviceId)}/session`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge: challenge.challenge, signature: signed.signatureDer })
  });
  const session = await readJsonResponse<{ deviceSessionToken: string; expiresAt: string }>(
    sessionResponse,
    "Failed to authenticate device session"
  );
  if (activeScopeKey !== scopeKey || establishmentGeneration !== generation) {
    throw new Error("Device session establishment was superseded by a newer identity or relay scope.");
  }
  currentSession = { token: session.deviceSessionToken, expiresAt: session.expiresAt, scopeKey };
  return currentSession;
}

/** Coalesces reconnect recovery so concurrent HTTP and WebSocket failures cannot rotate each other's new token. */
export function renewDeviceSession(
  relayHttpUrl: string,
  deviceId: string,
  rejectedToken?: string
): Promise<DeviceSession> {
  const key = deviceSessionScopeKey(relayHttpUrl, deviceId);
  if (activeScopeKey !== null && activeScopeKey !== key) {
    return Promise.reject(new Error("Device session renewal was superseded by a newer identity or relay scope."));
  }
  activeScopeKey = key;
  if (rejectedToken && currentSession?.scopeKey === key && currentSession.token !== rejectedToken) {
    return Promise.resolve(currentSession);
  }
  const existing = renewals.get(key);
  if (existing) return existing;
  const generation = ++establishmentGeneration;
  const renewal = establishDeviceSessionForScope(relayHttpUrl, deviceId, key, generation).finally(() => {
    if (renewals.get(key) === renewal) renewals.delete(key);
  });
  renewals.set(key, renewal);
  return renewal;
}

export async function retryAfterDeviceSessionExpiry<T>(
  relayHttpUrl: string,
  deviceId: string,
  operation: () => Promise<T>,
  onRenewed: (session: DeviceSession) => void
): Promise<T> {
  const rejectedToken = currentSession?.token;
  try {
    return await operation();
  } catch (error) {
    if (!isRelayHttpErrorCode(error, "device_auth_required")) throw error;
    onRenewed(await renewDeviceSession(relayHttpUrl, deviceId, rejectedToken));
    return operation();
  }
}

export async function recoverDeviceSessionForRelayError(
  error: { code?: string | undefined },
  relayHttpUrl: string,
  deviceId: string,
  rejectedToken: string,
  onRenewed: (session: DeviceSession) => void
): Promise<boolean> {
  if (error.code !== "not_joined") return false;
  onRenewed(await renewDeviceSession(relayHttpUrl, deviceId, rejectedToken));
  return true;
}

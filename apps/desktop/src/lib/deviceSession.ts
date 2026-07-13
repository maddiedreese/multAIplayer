import { signDeviceChallenge } from "./mlsClient";
import { readJsonResponse } from "./httpResponse";

export interface DeviceSession {
  token: string;
  expiresAt: string;
}

let currentToken: string | null = null;

export function deviceSessionHeaders(): Record<string, string> {
  if (!currentToken) throw new Error("Device-authenticated relay session is unavailable.");
  return { "x-device-session": currentToken };
}

export async function establishDeviceSession(relayHttpUrl: string, deviceId: string): Promise<DeviceSession> {
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
  currentToken = session.deviceSessionToken;
  return { token: session.deviceSessionToken, expiresAt: session.expiresAt };
}

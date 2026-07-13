import { sendRelayError } from "./errors.js";
import type { CookieOptions, Express } from "express";
import { nanoid } from "nanoid";
import type { AuthSession, RelayStore } from "../state.js";

interface RegisterDebugRoutesOptions {
  app: Express;
  debugEndpointsEnabled: boolean;
  store: Pick<RelayStore, "allMlsBacklogEntries">;
  invites: Map<string, unknown>;
  attachmentBlobs: Map<string, unknown>;
  authSessions: Map<string, AuthSession>;
  authSessionMaxAgeMs: number;
  authCookieOptions: (maxAge?: number) => CookieOptions;
  scheduleStoreSave: () => void;
  pruneExpiredRelayState: () => void;
  parseIntegerValue: (value: unknown, fallback: number, min: number, max: number) => number;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxUserIdChars: number;
  maxDisplayNameChars: number;
}

export function registerDebugRoutes({
  app,
  debugEndpointsEnabled,
  store,
  invites,
  attachmentBlobs,
  authSessions,
  authSessionMaxAgeMs,
  authCookieOptions,
  scheduleStoreSave,
  pruneExpiredRelayState,
  parseIntegerValue,
  normalizeMetadataText,
  maxUserIdChars,
  maxDisplayNameChars
}: RegisterDebugRoutesOptions) {
  app.get("/debug/rooms", (req, res) => {
    if (!debugEndpointsEnabled || !isLoopbackRequest(req.socket.remoteAddress)) {
      sendRelayError(res, 404, "not_found", "Debug endpoints are disabled.");
      return;
    }
    pruneExpiredRelayState();
    res.json({
      invites: invites.size,
      attachmentBlobs: attachmentBlobs.size,
      rooms: store.allMlsBacklogEntries().map(([key, messages]) => ({
        key,
        messages: messages.length,
        sample: messages.at(-1)
          ? {
              id: messages.at(-1)?.id,
              messageType: messages.at(-1)?.messageType,
              encodedBytes: messages.at(-1)?.mlsMessage.length
            }
          : null
      }))
    });
  });

  app.post("/debug/auth-session", (req, res) => {
    if (!debugEndpointsEnabled || !isLoopbackRequest(req.socket.remoteAddress)) {
      sendRelayError(res, 404, "not_found", "Debug endpoints are disabled.");
      return;
    }
    const id = String(req.body?.id ?? "").trim();
    const login = String(req.body?.login ?? id.replace(/^github:/, "")).trim();
    const name = String(req.body?.name ?? login).trim();
    const ttlMs = parseIntegerValue(req.body?.ttlMs, 1000 * 60 * 60, -1000 * 60 * 60, authSessionMaxAgeMs);
    const userId = normalizeMetadataText(id, maxUserIdChars);
    const normalizedLogin = normalizeMetadataText(login, maxDisplayNameChars);
    const normalizedName = normalizeMetadataText(name, maxDisplayNameChars);
    if (!userId || !normalizedLogin || !normalizedName) {
      sendRelayError(
        res,
        400,
        "invalid_request",
        "id, login, and name must be bounded strings without control characters"
      );
      return;
    }
    const sessionId = nanoid(32);
    const session: AuthSession = {
      accessToken: "debug-token",
      user: { id: userId, login: normalizedLogin, name: normalizedName },
      expiresAt: Date.now() + ttlMs
    };
    authSessions.set(sessionId, session);
    scheduleStoreSave();
    res.cookie("multaiplayer_session", sessionId, authCookieOptions(ttlMs));
    res.status(201).json({ user: session.user });
  });
}

function isLoopbackRequest(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.toLowerCase().split("%")[0];
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

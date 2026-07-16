import { sendRelayError } from "./errors.js";
import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import type { createRelayMetrics } from "../observability.js";
import { parseCookieHeader } from "../auth/session.js";
import type { TokenBucketRecord } from "../state.js";

interface RelayRequestGuardsOptions {
  rateLimitsEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitCaps: {
    auth: number;
    read: number;
    mutation: number;
    attachment: number;
    websocket: number;
    websocketConnect: number;
  };
  rateLimitStore: Map<string, TokenBucketRecord>;
  trustProxyHeaders: boolean;
  metrics: ReturnType<typeof createRelayMetrics>;
  normalizeSessionId: (value: unknown) => string;
}

type RateLimitBucket = RelayRequestGuardsOptions["rateLimitCaps"] extends Record<infer Key, number> ? Key : never;

export function createRelayRequestGuards({
  rateLimitsEnabled,
  rateLimitWindowMs,
  rateLimitCaps,
  rateLimitStore,
  trustProxyHeaders,
  metrics,
  normalizeSessionId
}: RelayRequestGuardsOptions) {
  let nextRateLimitPruneAt = 0;
  function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const bucket = rateLimitBucketForRequest(req);
    if (!bucket) {
      next();
      return;
    }
    const result = consumeRateLimit(bucket, clientIdentityFromRequest(req));
    if (result.allowed) {
      metrics.recordRateLimitAllowed(bucket);
      next();
      return;
    }
    metrics.recordRateLimitRejection(bucket);
    res.setHeader("Retry-After", String(Math.ceil(Math.max(0, result.resetAt - Date.now()) / 1000)));
    sendRelayError(res, 429, "rate_limited", "Rate limit exceeded. Slow down before retrying.", {
      bucket,
      retryAfterSeconds: Math.ceil(Math.max(0, result.resetAt - Date.now()) / 1000)
    });
  }

  function rateLimitBucketForRequest(req: Request): RateLimitBucket | null {
    if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/metrics" || req.path === "/auth/config")
      return null;
    if (req.path.startsWith("/auth/")) return "auth";
    if (req.path.startsWith("/attachment-blobs")) return "attachment";
    if (req.method === "GET") return "read";
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return "mutation";
    return null;
  }

  function consumeRateLimit(
    bucket: RateLimitBucket,
    clientId: string
  ): { allowed: true; resetAt: number } | { allowed: false; resetAt: number } {
    if (!rateLimitsEnabled) return { allowed: true, resetAt: Date.now() + rateLimitWindowMs };
    const now = Date.now();
    pruneRateLimitStore(now);
    const key = `${bucket}:${clientId}`;
    const capacity = rateLimitCaps[bucket];
    const refillPerMs = capacity / rateLimitWindowMs;
    const current = rateLimitStore.get(key);
    const tokens = current
      ? Math.min(capacity, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs)
      : capacity;
    const allowed = tokens >= 1;
    const remaining = allowed ? tokens - 1 : tokens;
    const resetAt = allowed
      ? now + Math.ceil((capacity - remaining) / refillPerMs)
      : now + Math.ceil((1 - remaining) / refillPerMs);
    rateLimitStore.set(key, { tokens: remaining, updatedAt: now, lastSeenAt: now });
    const pruneAt = now + rateLimitWindowMs * 2;
    nextRateLimitPruneAt = nextRateLimitPruneAt === 0 ? pruneAt : Math.min(nextRateLimitPruneAt, pruneAt);
    return allowed ? { allowed: true, resetAt } : { allowed: false, resetAt };
  }

  function pruneRateLimitStore(now = Date.now()) {
    if (now < nextRateLimitPruneAt) return;
    let earliestLiveExpiry = Number.POSITIVE_INFINITY;
    for (const [key, record] of rateLimitStore.entries()) {
      const expiresAt = record.lastSeenAt + rateLimitWindowMs * 2;
      if (expiresAt <= now) rateLimitStore.delete(key);
      else earliestLiveExpiry = Math.min(earliestLiveExpiry, expiresAt);
    }
    nextRateLimitPruneAt = Number.isFinite(earliestLiveExpiry) ? earliestLiveExpiry : now + rateLimitWindowMs;
  }

  function clientIdentityFromRequest(req: Request): string {
    const sessionId = normalizeSessionId(req.cookies?.multaiplayer_session);
    if (sessionId) return `session:${sessionId}`;
    return clientIdentityFromIncomingMessage(req);
  }

  function clientIdentityFromIncomingMessage(request: IncomingMessage): string {
    const cookies = parseCookieHeader(request.headers.cookie);
    const sessionId = normalizeSessionId(cookies.get("multaiplayer_session"));
    if (sessionId) return `session:${sessionId}`;
    const forwardedIp = trustProxyHeaders
      ? firstHeaderValue(request.headers["x-real-ip"]) || firstForwardedForIp(request.headers["x-forwarded-for"])
      : null;
    const ip = forwardedIp || request.socket.remoteAddress || "unknown";
    return `ip:${ip}`;
  }

  return {
    rateLimitMiddleware,
    clientIdentityFromIncomingMessage,
    consumeRateLimit
  };
}

function firstForwardedForIp(header: string | string[] | undefined): string | null {
  const value = firstHeaderValue(header);
  const ip = value?.split(",")[0]?.trim();
  return ip || null;
}

function firstHeaderValue(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}

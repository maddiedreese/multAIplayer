import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface RelayMetricsSnapshot {
  activeSockets: number;
  envelopesPublishedTotal: number;
  quotaRejectionsTotal: number;
  quotaRejectionsByType: Record<string, number>;
  rateLimitRejectionsTotal: number;
  startedAt: string;
  uptimeSeconds: number;
}

export interface RelayMetrics {
  recordEnvelopePublished(): void;
  recordQuotaRejection(type: string): void;
  recordRateLimitRejection(): void;
  snapshot(activeSockets: number): RelayMetricsSnapshot;
}

export function createRelayMetrics(now = () => Date.now()): RelayMetrics {
  const startedAtMs = now();
  let envelopesPublishedTotal = 0;
  let quotaRejectionsTotal = 0;
  const quotaRejectionsByType = new Map<string, number>();
  let rateLimitRejectionsTotal = 0;

  return {
    recordEnvelopePublished() {
      envelopesPublishedTotal += 1;
    },
    recordQuotaRejection(type) {
      const normalizedType = normalizeMetricType(type);
      quotaRejectionsTotal += 1;
      quotaRejectionsByType.set(normalizedType, (quotaRejectionsByType.get(normalizedType) ?? 0) + 1);
    },
    recordRateLimitRejection() {
      rateLimitRejectionsTotal += 1;
    },
    snapshot(activeSockets) {
      return {
        activeSockets,
        envelopesPublishedTotal,
        quotaRejectionsTotal,
        quotaRejectionsByType: Object.fromEntries(quotaRejectionsByType),
        rateLimitRejectionsTotal,
        startedAt: new Date(startedAtMs).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((now() - startedAtMs) / 1000))
      };
    }
  };
}

function normalizeMetricType(type: string): string {
  const normalized = type.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 80);
  return normalized || "unknown";
}

export function requestLoggingMiddleware(enabled: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = requestIdFromHeader(req.headers["x-request-id"]) ?? randomUUID();
    res.setHeader("x-request-id", requestId);

    if (enabled) {
      const startedAt = Date.now();
      res.on("finish", () => {
        logJson({
          event: "http_request",
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt
        });
      });
    }

    next();
  };
}

function requestIdFromHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length > 120 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function logJson(record: Record<string, unknown>) {
  console.log(JSON.stringify({
    service: "multaiplayer-relay",
    at: new Date().toISOString(),
    ...record
  }));
}

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface RelayMetricsSnapshot {
  activeSockets: number;
  liveAttachmentBlobCount?: number;
  liveAttachmentBlobBytes?: number;
  envelopesPublishedTotal: number;
  attachmentBlobUploadsTotal: number;
  attachmentBlobUploadBytesTotal: number;
  attachmentBlobUploadRejectionsByReason: Record<string, number>;
  quotaRejectionsTotal: number;
  quotaRejectionsByType: Record<string, number>;
  rateLimitRejectionsTotal: number;
  rateLimitRejectionsByBucket: Record<string, number>;
  webSocketConnectionAttemptsTotal: number;
  webSocketConnectionsAcceptedTotal: number;
  webSocketConnectionRejectionsByReason: Record<string, number>;
  startedAt: string;
  uptimeSeconds: number;
}

export interface RelayMetrics {
  recordEnvelopePublished(): void;
  recordAttachmentBlobUpload(bytes: number): void;
  recordAttachmentBlobUploadRejection(reason: string): void;
  recordQuotaRejection(type: string): void;
  recordRateLimitRejection(bucket?: string): void;
  recordWebSocketConnectionAttempt(): void;
  recordWebSocketConnectionAccepted(): void;
  recordWebSocketConnectionRejection(reason: string): void;
  snapshot(activeSockets: number, gauges?: RelayMetricsSnapshotGauges): RelayMetricsSnapshot;
}

export interface RelayMetricsSnapshotGauges {
  liveAttachmentBlobCount?: number;
  liveAttachmentBlobBytes?: number;
}

export function createRelayMetrics(now = () => Date.now()): RelayMetrics {
  const startedAtMs = now();
  let envelopesPublishedTotal = 0;
  let attachmentBlobUploadsTotal = 0;
  let attachmentBlobUploadBytesTotal = 0;
  const attachmentBlobUploadRejectionsByReason = new Map<string, number>();
  let quotaRejectionsTotal = 0;
  const quotaRejectionsByType = new Map<string, number>();
  let rateLimitRejectionsTotal = 0;
  const rateLimitRejectionsByBucket = new Map<string, number>();
  let webSocketConnectionAttemptsTotal = 0;
  let webSocketConnectionsAcceptedTotal = 0;
  const webSocketConnectionRejectionsByReason = new Map<string, number>();

  return {
    recordEnvelopePublished() {
      envelopesPublishedTotal += 1;
    },
    recordAttachmentBlobUpload(bytes) {
      attachmentBlobUploadsTotal += 1;
      attachmentBlobUploadBytesTotal += Math.max(0, Math.round(bytes));
    },
    recordAttachmentBlobUploadRejection(reason) {
      incrementMap(attachmentBlobUploadRejectionsByReason, normalizeMetricType(reason));
    },
    recordQuotaRejection(type) {
      const normalizedType = normalizeMetricType(type);
      quotaRejectionsTotal += 1;
      incrementMap(quotaRejectionsByType, normalizedType);
    },
    recordRateLimitRejection(bucket = "unknown") {
      rateLimitRejectionsTotal += 1;
      incrementMap(rateLimitRejectionsByBucket, normalizeMetricType(bucket));
    },
    recordWebSocketConnectionAttempt() {
      webSocketConnectionAttemptsTotal += 1;
    },
    recordWebSocketConnectionAccepted() {
      webSocketConnectionsAcceptedTotal += 1;
    },
    recordWebSocketConnectionRejection(reason) {
      incrementMap(webSocketConnectionRejectionsByReason, normalizeMetricType(reason));
    },
    snapshot(activeSockets, gauges = {}) {
      return {
        activeSockets,
        ...gauges,
        envelopesPublishedTotal,
        attachmentBlobUploadsTotal,
        attachmentBlobUploadBytesTotal,
        attachmentBlobUploadRejectionsByReason: Object.fromEntries(attachmentBlobUploadRejectionsByReason),
        quotaRejectionsTotal,
        quotaRejectionsByType: Object.fromEntries(quotaRejectionsByType),
        rateLimitRejectionsTotal,
        rateLimitRejectionsByBucket: Object.fromEntries(rateLimitRejectionsByBucket),
        webSocketConnectionAttemptsTotal,
        webSocketConnectionsAcceptedTotal,
        webSocketConnectionRejectionsByReason: Object.fromEntries(webSocketConnectionRejectionsByReason),
        startedAt: new Date(startedAtMs).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((now() - startedAtMs) / 1000))
      };
    }
  };
}

function incrementMap(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function normalizeMetricType(type: string): string {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80);
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
  console.log(
    JSON.stringify({
      service: "multaiplayer-relay",
      at: new Date().toISOString(),
      ...record
    })
  );
}

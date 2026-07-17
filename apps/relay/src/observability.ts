import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

export interface RelayMetricsSnapshot {
  activeSockets: number;
  liveAttachmentBlobCount?: number;
  liveAttachmentBlobBytes?: number;
  retainedMlsBacklogBytes?: number;
  retainedAttachmentBlobBytes?: number;
  retainedMlsBacklogLimitBytes?: number;
  retainedAttachmentBlobLimitBytes?: number;
  sqliteDatabaseBytes?: number;
  sqliteWalBytes?: number;
  sqliteFilesystemAvailableBytes?: number;
  sqliteBackupLastSuccessTimestampSeconds?: number;
  eventLoopDelayP99Seconds?: number;
  eventLoopDelayMaxSeconds?: number;
  envelopesPublishedTotal: number;
  attachmentBlobUploadsTotal: number;
  attachmentBlobUploadBytesTotal: number;
  attachmentBlobUploadRejectionsByReason: Record<string, number>;
  quotaRejectionsTotal: number;
  quotaRejectionsByType: Record<string, number>;
  capacityRejectionsByReason: Record<string, number>;
  rateLimitRejectionsTotal: number;
  rateLimitRejectionsByBucket: Record<string, number>;
  rateLimitAllowedTotal: number;
  rateLimitAllowedByBucket: Record<string, number>;
  webSocketConnectionAttemptsTotal: number;
  webSocketConnectionsAcceptedTotal: number;
  webSocketConnectionRejectionsByReason: Record<string, number>;
  publishToFanoutDurationSeconds: RelayHistogramSnapshot;
  webSocketSendDurationSeconds: RelayHistogramSnapshot;
  sqliteWriteDurationSeconds: RelayHistogramSnapshot;
  startedAt: string;
  uptimeSeconds: number;
}

export interface RelayHistogramSnapshot {
  buckets: Record<string, number>;
  count: number;
  sum: number;
}

export interface RelayMetrics {
  recordMlsMessagePublished(): void;
  recordAttachmentBlobUpload(bytes: number): void;
  recordAttachmentBlobUploadRejection(reason: string): void;
  recordQuotaRejection(type: string): void;
  recordCapacityRejection(resource: string, scope: string): void;
  recordRateLimitRejection(bucket?: string): void;
  recordRateLimitAllowed(bucket?: string): void;
  recordWebSocketConnectionAttempt(): void;
  recordWebSocketConnectionAccepted(): void;
  recordWebSocketConnectionRejection(reason: string): void;
  recordPublishToFanoutDuration(durationMs: number): void;
  recordWebSocketSendDuration(durationMs: number): void;
  recordSqliteWriteDuration(durationMs: number): void;
  snapshot(activeSockets: number, gauges?: RelayMetricsSnapshotGauges): RelayMetricsSnapshot;
}

export interface RelayMetricsSnapshotGauges {
  liveAttachmentBlobCount?: number;
  liveAttachmentBlobBytes?: number;
  retainedMlsBacklogBytes?: number;
  retainedAttachmentBlobBytes?: number;
  retainedMlsBacklogLimitBytes?: number;
  retainedAttachmentBlobLimitBytes?: number;
  sqliteDatabaseBytes?: number;
  sqliteWalBytes?: number;
  sqliteFilesystemAvailableBytes?: number;
  sqliteBackupLastSuccessTimestampSeconds?: number;
}

export function relayMetricsToPrometheus(snapshot: RelayMetricsSnapshot): string {
  const lines: string[] = [];
  const metric = (name: string, type: "counter" | "gauge", help: string, value: number) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${finiteMetricValue(value)}`);
  };
  const labeled = (name: string, help: string, label: string, values: Record<string, number>) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [key, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`${name}{${label}="${escapePrometheusLabel(key)}"} ${finiteMetricValue(value)}`);
    }
  };
  const histogram = (name: string, help: string, value: RelayHistogramSnapshot) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} histogram`);
    for (const [boundary, count] of Object.entries(value.buckets).sort(
      ([left], [right]) => Number(left) - Number(right)
    )) {
      lines.push(`${name}_bucket{le="${boundary}"} ${finiteMetricValue(count)}`);
    }
    lines.push(
      `${name}_bucket{le="+Inf"} ${finiteMetricValue(value.count)}`,
      `${name}_sum ${finiteMetricValue(value.sum)}`,
      `${name}_count ${finiteMetricValue(value.count)}`
    );
  };

  metric(
    "multaiplayer_relay_active_sockets",
    "gauge",
    "Currently active relay WebSocket sessions.",
    snapshot.activeSockets
  );
  metric(
    "multaiplayer_relay_event_loop_delay_p99_seconds",
    "gauge",
    "Observed p99 Node.js event-loop delay since process start.",
    snapshot.eventLoopDelayP99Seconds ?? 0
  );
  metric(
    "multaiplayer_relay_event_loop_delay_max_seconds",
    "gauge",
    "Maximum observed Node.js event-loop delay since process start.",
    snapshot.eventLoopDelayMaxSeconds ?? 0
  );
  metric(
    "multaiplayer_relay_live_attachment_blobs",
    "gauge",
    "Currently retained, non-expired attachment blobs.",
    snapshot.liveAttachmentBlobCount ?? 0
  );
  metric(
    "multaiplayer_relay_live_attachment_blob_bytes",
    "gauge",
    "Bytes currently retained by non-expired attachment blobs.",
    snapshot.liveAttachmentBlobBytes ?? 0
  );
  metric(
    "multaiplayer_relay_retained_mls_backlog_bytes",
    "gauge",
    "Bytes currently retained by MLS backlog envelopes.",
    snapshot.retainedMlsBacklogBytes ?? 0
  );
  metric(
    "multaiplayer_relay_retained_mls_backlog_limit_bytes",
    "gauge",
    "Configured relay-wide MLS backlog byte ceiling.",
    snapshot.retainedMlsBacklogLimitBytes ?? 0
  );
  metric(
    "multaiplayer_relay_retained_attachment_blob_bytes",
    "gauge",
    "Bytes currently retained by encrypted attachment blobs, including entries pending expiry reclamation.",
    snapshot.retainedAttachmentBlobBytes ?? 0
  );
  metric(
    "multaiplayer_relay_retained_attachment_blob_limit_bytes",
    "gauge",
    "Configured relay-wide encrypted attachment byte ceiling.",
    snapshot.retainedAttachmentBlobLimitBytes ?? 0
  );
  metric(
    "multaiplayer_relay_sqlite_database_bytes",
    "gauge",
    "Bytes occupied by the primary SQLite database file.",
    snapshot.sqliteDatabaseBytes ?? 0
  );
  metric(
    "multaiplayer_relay_sqlite_wal_bytes",
    "gauge",
    "Bytes occupied by the active SQLite write-ahead log.",
    snapshot.sqliteWalBytes ?? 0
  );
  metric(
    "multaiplayer_relay_sqlite_filesystem_available_bytes",
    "gauge",
    "Bytes available on the filesystem containing the SQLite database.",
    snapshot.sqliteFilesystemAvailableBytes ?? 0
  );
  metric(
    "multaiplayer_relay_sqlite_backup_last_success_timestamp_seconds",
    "gauge",
    "Unix timestamp of the last independently verified SQLite backup and restore drill.",
    snapshot.sqliteBackupLastSuccessTimestampSeconds ?? 0
  );
  metric(
    "multaiplayer_relay_envelopes_published_total",
    "counter",
    "Accepted MLS envelopes.",
    snapshot.envelopesPublishedTotal
  );
  metric(
    "multaiplayer_relay_attachment_blob_uploads_total",
    "counter",
    "Accepted attachment blob uploads.",
    snapshot.attachmentBlobUploadsTotal
  );
  metric(
    "multaiplayer_relay_attachment_blob_upload_bytes_total",
    "counter",
    "Accepted attachment blob upload bytes.",
    snapshot.attachmentBlobUploadBytesTotal
  );
  labeled(
    "multaiplayer_relay_attachment_blob_upload_rejections_total",
    "Rejected attachment blob uploads by reason.",
    "reason",
    snapshot.attachmentBlobUploadRejectionsByReason
  );
  metric(
    "multaiplayer_relay_quota_rejections_total",
    "counter",
    "Requests rejected by creation or storage quotas.",
    snapshot.quotaRejectionsTotal
  );
  labeled(
    "multaiplayer_relay_quota_rejections_by_type_total",
    "Quota rejections by quota type.",
    "type",
    snapshot.quotaRejectionsByType
  );
  labeled(
    "multaiplayer_relay_capacity_rejections_total",
    "Requests rejected by durable relay capacity ceilings.",
    "reason",
    snapshot.capacityRejectionsByReason
  );
  metric(
    "multaiplayer_relay_rate_limit_rejections_total",
    "counter",
    "Requests rejected by rate limits.",
    snapshot.rateLimitRejectionsTotal
  );
  labeled(
    "multaiplayer_relay_rate_limit_rejections_by_bucket_total",
    "Rate-limit rejections by bucket.",
    "bucket",
    snapshot.rateLimitRejectionsByBucket
  );
  metric(
    "multaiplayer_relay_rate_limit_allowed_total",
    "counter",
    "Requests admitted by configured rate-limit buckets.",
    snapshot.rateLimitAllowedTotal ?? 0
  );
  labeled(
    "multaiplayer_relay_rate_limit_allowed_by_bucket_total",
    "Admitted requests by rate-limit bucket, providing an adoption denominator for rejection alerts.",
    "bucket",
    snapshot.rateLimitAllowedByBucket ?? {}
  );
  metric(
    "multaiplayer_relay_websocket_connection_attempts_total",
    "counter",
    "WebSocket connection attempts.",
    snapshot.webSocketConnectionAttemptsTotal
  );
  metric(
    "multaiplayer_relay_websocket_connections_accepted_total",
    "counter",
    "Accepted WebSocket connections.",
    snapshot.webSocketConnectionsAcceptedTotal
  );
  labeled(
    "multaiplayer_relay_websocket_connection_rejections_total",
    "Rejected WebSocket connections by reason.",
    "reason",
    snapshot.webSocketConnectionRejectionsByReason
  );
  histogram(
    "multaiplayer_relay_publish_to_fanout_duration_seconds",
    "Time from an MLS publish entering its room queue until successful persistence and fanout.",
    snapshot.publishToFanoutDurationSeconds
  );
  histogram(
    "multaiplayer_relay_websocket_send_duration_seconds",
    "Time for queued WebSocket sends to complete, including transport backpressure.",
    snapshot.webSocketSendDurationSeconds
  );
  histogram(
    "multaiplayer_relay_sqlite_write_duration_seconds",
    "Time spent in synchronous SQLite relay write operations.",
    snapshot.sqliteWriteDurationSeconds
  );
  metric("multaiplayer_relay_uptime_seconds", "gauge", "Relay process uptime in seconds.", snapshot.uptimeSeconds);
  metric(
    "multaiplayer_relay_start_time_seconds",
    "gauge",
    "Relay process start time as Unix seconds.",
    Date.parse(snapshot.startedAt) / 1000
  );
  return `${lines.join("\n")}\n`;
}

function finiteMetricValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export type RelayLogLevel = "info" | "warn" | "error";
export type RelayLogSink = (line: string) => void;

export function logRelayEvent(
  level: RelayLogLevel,
  event: string,
  fields: Record<string, string | number | boolean> = {},
  sink: RelayLogSink = defaultRelayLogSink(level)
) {
  sink(
    JSON.stringify({
      ...fields,
      service: "multaiplayer-relay",
      at: new Date().toISOString(),
      level,
      event
    })
  );
}

export function createRelayMetrics(now = () => Date.now()): RelayMetrics {
  const startedAtMs = now();
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
  eventLoopDelay.enable();
  let envelopesPublishedTotal = 0;
  let attachmentBlobUploadsTotal = 0;
  let attachmentBlobUploadBytesTotal = 0;
  const attachmentBlobUploadRejectionsByReason = new Map<string, number>();
  let quotaRejectionsTotal = 0;
  const quotaRejectionsByType = new Map<string, number>();
  const capacityRejectionsByReason = new Map<string, number>();
  let rateLimitRejectionsTotal = 0;
  const rateLimitRejectionsByBucket = new Map<string, number>();
  let rateLimitAllowedTotal = 0;
  const rateLimitAllowedByBucket = new Map<string, number>();
  let webSocketConnectionAttemptsTotal = 0;
  let webSocketConnectionsAcceptedTotal = 0;
  const webSocketConnectionRejectionsByReason = new Map<string, number>();
  const publishToFanoutDuration = createFixedBucketHistogram();
  const webSocketSendDuration = createFixedBucketHistogram();
  const sqliteWriteDuration = createFixedBucketHistogram();

  return {
    recordMlsMessagePublished() {
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
    recordCapacityRejection(resource, scope) {
      incrementMap(capacityRejectionsByReason, normalizeMetricType(`${scope}_${resource}`));
    },
    recordRateLimitRejection(bucket = "unknown") {
      rateLimitRejectionsTotal += 1;
      incrementMap(rateLimitRejectionsByBucket, normalizeMetricType(bucket));
    },
    recordRateLimitAllowed(bucket = "unknown") {
      rateLimitAllowedTotal += 1;
      incrementMap(rateLimitAllowedByBucket, normalizeMetricType(bucket));
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
    recordPublishToFanoutDuration(durationMs) {
      publishToFanoutDuration.observe(millisecondsToSeconds(durationMs));
    },
    recordWebSocketSendDuration(durationMs) {
      webSocketSendDuration.observe(millisecondsToSeconds(durationMs));
    },
    recordSqliteWriteDuration(durationMs) {
      sqliteWriteDuration.observe(millisecondsToSeconds(durationMs));
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
        capacityRejectionsByReason: Object.fromEntries(capacityRejectionsByReason),
        rateLimitRejectionsTotal,
        rateLimitRejectionsByBucket: Object.fromEntries(rateLimitRejectionsByBucket),
        rateLimitAllowedTotal,
        rateLimitAllowedByBucket: Object.fromEntries(rateLimitAllowedByBucket),
        webSocketConnectionAttemptsTotal,
        webSocketConnectionsAcceptedTotal,
        webSocketConnectionRejectionsByReason: Object.fromEntries(webSocketConnectionRejectionsByReason),
        publishToFanoutDurationSeconds: publishToFanoutDuration.snapshot(),
        webSocketSendDurationSeconds: webSocketSendDuration.snapshot(),
        sqliteWriteDurationSeconds: sqliteWriteDuration.snapshot(),
        eventLoopDelayP99Seconds: finiteEventLoopDelaySeconds(eventLoopDelay.percentile(99)),
        eventLoopDelayMaxSeconds: finiteEventLoopDelaySeconds(eventLoopDelay.max),
        startedAt: new Date(startedAtMs).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((now() - startedAtMs) / 1000))
      };
    }
  };
}

function finiteEventLoopDelaySeconds(nanoseconds: number): number {
  return Number.isFinite(nanoseconds) ? nanoseconds / 1_000_000_000 : 0;
}

const latencyBucketsSeconds = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

function createFixedBucketHistogram() {
  const counts = new Map(latencyBucketsSeconds.map((boundary) => [boundary, 0]));
  let count = 0;
  let sum = 0;
  return {
    observe(value: number) {
      const finiteValue = Number.isFinite(value) ? Math.max(0, value) : 0;
      count += 1;
      sum += finiteValue;
      for (const boundary of latencyBucketsSeconds) {
        if (finiteValue <= boundary) counts.set(boundary, (counts.get(boundary) ?? 0) + 1);
      }
    },
    snapshot(): RelayHistogramSnapshot {
      return { buckets: Object.fromEntries(counts), count, sum };
    }
  };
}

function millisecondsToSeconds(durationMs: number): number {
  return durationMs / 1_000;
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
  logRelayEvent(
    "info",
    String(record.event ?? "relay_event"),
    Object.fromEntries(
      Object.entries(record).filter(
        ([key, value]) => key !== "event" && ["string", "number", "boolean"].includes(typeof value)
      )
    ) as Record<string, string | number | boolean>
  );
}

function defaultRelayLogSink(level: RelayLogLevel): RelayLogSink {
  if (process.env.NODE_ENV === "test") return () => undefined;
  const stream = level === "info" ? process.stdout : process.stderr;
  return (line) => stream.write(`${line}\n`);
}

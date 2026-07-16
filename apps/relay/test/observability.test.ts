import assert from "node:assert/strict";
import test from "node:test";
import { createRelayMetrics, logRelayEvent, relayMetricsToPrometheus } from "../src/observability.js";

test("relay operational logs are structured and contain only explicit safe fields", () => {
  const lines: string[] = [];
  logRelayEvent(
    "warn",
    "invalid_configuration_ignored",
    { setting: "storage", minimumCharacters: 32, service: "untrusted-override" },
    (line) => lines.push(line)
  );
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(record.service, "multaiplayer-relay");
  assert.equal(record.level, "warn");
  assert.equal(record.event, "invalid_configuration_ignored");
  assert.equal(record.setting, "storage");
  assert.equal(record.minimumCharacters, 32);
  assert.match(String(record.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(record).includes("credential"), false);
});

test("Prometheus metrics are stable, typed, and escape labels", () => {
  const output = relayMetricsToPrometheus({
    activeSockets: 2,
    liveAttachmentBlobCount: 1,
    liveAttachmentBlobBytes: 12,
    retainedMlsBacklogBytes: 123,
    retainedAttachmentBlobBytes: 456,
    envelopesPublishedTotal: 3,
    attachmentBlobUploadsTotal: 1,
    attachmentBlobUploadBytesTotal: 12,
    attachmentBlobUploadRejectionsByReason: { 'bad"reason\\line\n': 4 },
    quotaRejectionsTotal: 5,
    quotaRejectionsByType: { rooms: 5 },
    capacityRejectionsByReason: { team_attachment_blobs: 2 },
    rateLimitRejectionsTotal: 6,
    rateLimitRejectionsByBucket: { mutation: 6 },
    webSocketConnectionAttemptsTotal: 7,
    webSocketConnectionsAcceptedTotal: 2,
    webSocketConnectionRejectionsByReason: { quota: 5 },
    publishToFanoutDurationSeconds: { buckets: { "0.001": 0, "0.005": 2 }, count: 3, sum: 0.02 },
    webSocketSendDurationSeconds: { buckets: { "0.001": 1 }, count: 1, sum: 0.001 },
    sqliteWriteDurationSeconds: { buckets: { "0.001": 0 }, count: 2, sum: 0.004 },
    startedAt: "2026-01-01T00:00:00.000Z",
    uptimeSeconds: 8
  });

  assert.match(output, /# TYPE multaiplayer_relay_envelopes_published_total counter/);
  assert.match(output, /multaiplayer_relay_active_sockets 2/);
  assert.match(output, /multaiplayer_relay_retained_mls_backlog_bytes 123/);
  assert.match(output, /multaiplayer_relay_retained_attachment_blob_bytes 456/);
  assert.match(output, /reason="bad\\"reason\\\\line\\n"} 4/);
  assert.match(output, /multaiplayer_relay_publish_to_fanout_duration_seconds_bucket\{le="0\.005"} 2/);
  assert.match(output, /multaiplayer_relay_publish_to_fanout_duration_seconds_bucket\{le="\+Inf"} 3/);
  assert.match(output, /multaiplayer_relay_publish_to_fanout_duration_seconds_sum 0\.02/);
  assert.match(output, /multaiplayer_relay_sqlite_write_duration_seconds_count 2/);
  assert.match(output, /multaiplayer_relay_capacity_rejections_total\{reason="team_attachment_blobs"\} 2/);
  assert.match(output, /multaiplayer_relay_start_time_seconds 1767225600/);
  assert.ok(output.endsWith("\n"));
});

test("latency histograms use cumulative fixed buckets and sanitize invalid durations", () => {
  const metrics = createRelayMetrics(() => 0);
  metrics.recordPublishToFanoutDuration(3);
  metrics.recordPublishToFanoutDuration(20);
  metrics.recordWebSocketSendDuration(Number.NaN);
  metrics.recordSqliteWriteDuration(-5);

  const snapshot = metrics.snapshot(0);
  assert.equal(snapshot.publishToFanoutDurationSeconds.count, 2);
  assert.equal(snapshot.publishToFanoutDurationSeconds.buckets["0.001"], 0);
  assert.equal(snapshot.publishToFanoutDurationSeconds.buckets["0.005"], 1);
  assert.equal(snapshot.publishToFanoutDurationSeconds.buckets["0.025"], 2);
  assert.equal(snapshot.publishToFanoutDurationSeconds.sum, 0.023);
  assert.equal(snapshot.webSocketSendDurationSeconds.buckets["0.001"], 1);
  assert.equal(snapshot.sqliteWriteDurationSeconds.sum, 0);
});

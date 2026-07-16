import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Express } from "express";
import type { AttachmentBlobRecord } from "@multaiplayer/protocol";
import type { ClientSession } from "../state.js";
import { relayMetricsToPrometheus, type RelayMetrics } from "../observability.js";
import { attachmentBlobStorageBytes } from "./attachments.js";

interface RegisterOpsRoutesOptions {
  app: Express;
  dataPath: string;
  metrics: RelayMetrics;
  metricsToken: string | null;
  sessions: Pick<ReadonlyMap<unknown, ClientSession>, "size">;
  attachmentBlobs?: Iterable<AttachmentBlobRecord>;
  isExpiredAttachmentBlob?: (blob: AttachmentBlobRecord) => boolean;
  isReady?: () => boolean;
  readinessFailureCode?: () => "relay_shutting_down" | "persistence_unavailable";
  retainedByteUsage?: () => { mlsBacklogBytes: number; attachmentBlobBytes: number };
  retainedByteLimits?: { mlsBacklogBytes: number; attachmentBlobBytes: number };
}

export function registerOpsRoutes({
  app,
  dataPath,
  metrics,
  metricsToken,
  sessions,
  attachmentBlobs = [],
  isExpiredAttachmentBlob = () => false,
  isReady = () => true,
  readinessFailureCode = () => "relay_shutting_down",
  retainedByteUsage = () => ({ mlsBacklogBytes: 0, attachmentBlobBytes: 0 }),
  retainedByteLimits = { mlsBacklogBytes: 0, attachmentBlobBytes: 0 }
}: RegisterOpsRoutesOptions) {
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "multaiplayer-relay" });
  });

  app.get("/readyz", (_req, res) => {
    if (!isReady()) {
      res.status(503).json({ ok: false, code: readinessFailureCode() });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/metrics", (req, res) => {
    if (!metricsToken || !authorizedMetricsRequest(req.headers.authorization, metricsToken)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="multaiplayer-relay-metrics"');
      res.status(401).type("text/plain").send("Unauthorized\n");
      return;
    }
    const retained = retainedByteUsage();
    const snapshot = metrics.snapshot(sessions.size, {
      ...liveAttachmentBlobGauges(attachmentBlobs, isExpiredAttachmentBlob),
      retainedMlsBacklogBytes: retained.mlsBacklogBytes,
      retainedAttachmentBlobBytes: retained.attachmentBlobBytes,
      retainedMlsBacklogLimitBytes: retainedByteLimits.mlsBacklogBytes,
      retainedAttachmentBlobLimitBytes: retainedByteLimits.attachmentBlobBytes,
      ...sqliteOperationalGauges(dataPath)
    });
    res.type("text/plain; version=0.0.4; charset=utf-8").send(relayMetricsToPrometheus(snapshot));
  });
}

interface BackupDrillEvidence {
  status: "passed";
  completedAt: string;
}

function sqliteOperationalGauges(dataPath: string) {
  return {
    sqliteDatabaseBytes: fileSize(dataPath),
    sqliteWalBytes: fileSize(`${dataPath}-wal`),
    sqliteFilesystemAvailableBytes: availableFilesystemBytes(dirname(dataPath)),
    sqliteBackupLastSuccessTimestampSeconds: backupSuccessTimestamp(`${dataPath}.backup-evidence.json`)
  };
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function availableFilesystemBytes(path: string): number {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return 0;
  }
}

function backupSuccessTimestamp(path: string): number {
  try {
    const candidate = JSON.parse(readFileSync(path, "utf8")) as Partial<BackupDrillEvidence>;
    if (candidate.status !== "passed" || typeof candidate.completedAt !== "string") return 0;
    const timestamp = Date.parse(candidate.completedAt) / 1000;
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

function authorizedMetricsRequest(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedDigest = createHash("sha256").update(authorization.slice("Bearer ".length)).digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function liveAttachmentBlobGauges(
  attachmentBlobs: Iterable<AttachmentBlobRecord>,
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecord) => boolean
) {
  let liveAttachmentBlobCount = 0;
  let liveAttachmentBlobBytes = 0;
  for (const blob of attachmentBlobs) {
    if (isExpiredAttachmentBlob(blob)) continue;
    liveAttachmentBlobCount += 1;
    liveAttachmentBlobBytes += attachmentBlobStorageBytes(blob);
  }
  return { liveAttachmentBlobCount, liveAttachmentBlobBytes };
}

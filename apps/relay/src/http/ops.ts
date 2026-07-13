import { createHash, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import type { AttachmentBlobRecord } from "@multaiplayer/protocol";
import type { ClientSession } from "../state.js";
import { relayMetricsToPrometheus, type RelayMetrics } from "../observability.js";

interface RegisterOpsRoutesOptions {
  app: Express;
  dataPath: string;
  metrics: RelayMetrics;
  metricsToken: string | null;
  sessions: Pick<ReadonlyMap<unknown, ClientSession>, "size">;
  attachmentBlobs?: Iterable<AttachmentBlobRecord>;
  isExpiredAttachmentBlob?: (blob: AttachmentBlobRecord) => boolean;
  isReady?: () => boolean;
}

export function registerOpsRoutes({
  app,
  dataPath,
  metrics,
  metricsToken,
  sessions,
  attachmentBlobs = [],
  isExpiredAttachmentBlob = () => false,
  isReady = () => true
}: RegisterOpsRoutesOptions) {
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "multaiplayer-relay" });
  });

  app.get("/readyz", (_req, res) => {
    if (!isReady()) {
      res.status(503).json({ ok: false, dataPath, code: "relay_shutting_down" });
      return;
    }
    res.json({ ok: true, dataPath });
  });

  app.get("/metrics", (req, res) => {
    if (!metricsToken || !authorizedMetricsRequest(req.headers.authorization, metricsToken)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="multaiplayer-relay-metrics"');
      res.status(401).type("text/plain").send("Unauthorized\n");
      return;
    }
    const snapshot = metrics.snapshot(
      sessions.size,
      liveAttachmentBlobGauges(attachmentBlobs, isExpiredAttachmentBlob)
    );
    res.type("text/plain; version=0.0.4; charset=utf-8").send(relayMetricsToPrometheus(snapshot));
  });
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
    liveAttachmentBlobBytes += blob.size;
  }
  return { liveAttachmentBlobCount, liveAttachmentBlobBytes };
}

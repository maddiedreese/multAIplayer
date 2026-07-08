import type { Express } from "express";
import type { ClientSession } from "../state.js";
import type { RelayMetrics } from "../observability.js";

interface RegisterOpsRoutesOptions {
  app: Express;
  dataPath: string;
  metrics: RelayMetrics;
  sessions: Pick<ReadonlyMap<unknown, ClientSession>, "size">;
  isReady?: () => boolean;
}

export function registerOpsRoutes({ app, dataPath, metrics, sessions, isReady = () => true }: RegisterOpsRoutesOptions) {
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

  app.get("/metrics", (_req, res) => {
    res.json(metrics.snapshot(sessions.size));
  });
}

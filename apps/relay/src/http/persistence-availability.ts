import type { RequestHandler } from "express";
import { sendRelayError } from "./errors.js";

const availabilityExemptPaths = new Set(["/healthz", "/readyz", "/metrics"]);

export function persistenceAvailabilityMiddleware(isHealthy: () => boolean): RequestHandler {
  return (req, res, next) => {
    if (isHealthy() || availabilityExemptPaths.has(req.path)) {
      next();
      return;
    }
    sendRelayError(
      res,
      503,
      "persistence_unavailable",
      "Relay persistence is unavailable. Restart the relay before retrying."
    );
  };
}

import type { RequestHandler } from "express";
import type { CorsOptions } from "cors";

export interface RelayOriginPolicy {
  corsOptions: CorsOptions;
  isAllowedOrigin: (origin: string | undefined) => boolean;
  enforceAllowedOrigin: RequestHandler;
}

export function createRelayOriginPolicy({
  nodeEnv,
  allowedCorsOrigins
}: {
  nodeEnv: string;
  allowedCorsOrigins: string[];
}): RelayOriginPolicy {
  function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    if (allowedCorsOrigins.length > 0) return allowedCorsOrigins.includes(origin);
    return nodeEnv !== "production";
  }

  return {
    isAllowedOrigin,
    enforceAllowedOrigin(req, res, next) {
      if (isAllowedOrigin(req.get("origin"))) {
        next();
        return;
      }
      res.status(403).json({ error: "Origin not allowed" });
    },
    corsOptions: {
      credentials: true,
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      }
    }
  };
}

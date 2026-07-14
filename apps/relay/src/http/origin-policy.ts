import { sendRelayError } from "./errors.js";
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
    // Native and server-side clients do not necessarily send Origin. An empty
    // header is still a supplied (and invalid) origin, so only absence receives
    // this exemption.
    if (origin === undefined) return true;
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
      sendRelayError(res, 403, "forbidden", "Origin not allowed");
    },
    corsOptions: {
      credentials: true,
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      }
    }
  };
}

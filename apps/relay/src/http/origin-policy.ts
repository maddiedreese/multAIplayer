import { sendRelayError } from "./errors.js";
import type { RequestHandler } from "express";
import type { CorsOptions } from "cors";

export interface RelayOriginPolicy {
  corsOptions: CorsOptions;
  isAllowedOrigin: (origin: string | undefined) => boolean;
  enforceAllowedOrigin: RequestHandler;
  enforceCookieMutationCsrf: RequestHandler;
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
    enforceCookieMutationCsrf(req, res, next) {
      if (!isCookieAuthenticatedMutation(req.method, req.cookies?.multaiplayer_session)) {
        next();
        return;
      }

      // Browser mutations must carry an exact allowlisted Origin. The earlier
      // origin middleware has already rejected a supplied but disallowed value.
      // Native and server-side clients may omit both Origin and Fetch Metadata;
      // browsers cannot suppress these forbidden headers. Rejecting browser
      // Fetch Metadata without Origin closes that omission without inventing a
      // bearer CSRF token for non-browser clients.
      if (req.get("origin") !== undefined) {
        next();
        return;
      }
      const fetchSite = req.get("sec-fetch-site");
      if (fetchSite === undefined || fetchSite === "none") {
        next();
        return;
      }
      sendRelayError(res, 403, "forbidden", "Browser mutations require an allowed Origin.");
    },
    corsOptions: {
      credentials: true,
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      }
    }
  };
}

function isCookieAuthenticatedMutation(method: string, sessionCookie: unknown): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method) && typeof sessionCookie === "string";
}

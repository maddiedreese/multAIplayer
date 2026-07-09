import type { CorsOptions } from "cors";

export interface RelayOriginPolicy {
  corsOptions: CorsOptions;
  isAllowedOrigin: (origin: string | undefined) => boolean;
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
    corsOptions: {
      credentials: true,
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      }
    }
  };
}

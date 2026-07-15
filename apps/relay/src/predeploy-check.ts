import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { loadRelayConfig } from "./config.js";

const config = loadRelayConfig();
const violations: string[] = [];

if (config.nodeEnv !== "production") violations.push("NODE_ENV must be production");
if (config.allowedCorsOrigins.length === 0) violations.push("at least one exact allowed origin is required");
if (!config.mutationsRequireAuth) violations.push("relay authentication must be required");
if (!config.rateLimitsEnabled) violations.push("relay rate limits must be enabled");
if (config.debugEndpointsEnabled) violations.push("debug endpoints must be disabled");
if (!config.metricsToken) violations.push("a metrics token is required");

const validatorPath = process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH;
if (!validatorPath) {
  violations.push("the MLS KeyPackage validator path is required");
} else {
  try {
    await access(validatorPath, constants.X_OK);
  } catch {
    violations.push("the MLS KeyPackage validator must exist and be executable");
  }
}

if (violations.length > 0) {
  throw new Error(`Relay pre-deploy verification failed: ${violations.join("; ")}.`);
}

console.log("Relay pre-deploy verification passed.");

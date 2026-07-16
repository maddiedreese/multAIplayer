import { constants, statfsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { loadRelayConfig } from "./config.js";

const config = loadRelayConfig();
const violations: string[] = [];

if (config.nodeEnv !== "production") violations.push("NODE_ENV must be production");
if (config.allowedCorsOrigins.length === 0) violations.push("at least one exact allowed origin is required");
if (!config.mutationsRequireAuth) violations.push("relay authentication must be required");
if (!config.rateLimitsEnabled) violations.push("relay rate limits must be enabled");
if (config.debugEndpointsEnabled) violations.push("debug endpoints must be disabled");
if (!config.metricsToken) violations.push("a metrics token is required");
if (!config.structuredLogsEnabled) violations.push("structured logs must be enabled for persistence poison alerts");
if (!config.exitOnPersistencePoison)
  violations.push("persistence poison must terminate the process for supervised restart");
if (config.maxDurableEntriesPerTeam >= config.maxDurableEntries) {
  violations.push("per-team durable-entry ceiling must be lower than the global ceiling");
}
if (
  config.maxMlsBacklogBytesPerRoom > config.maxMlsBacklogBytesPerTeam ||
  config.maxMlsBacklogBytesPerTeam > config.maxMlsBacklogBytes
) {
  violations.push("MLS backlog byte ceilings must be ordered room <= team <= relay");
}
if (config.maxAttachmentBlobBytesPerTeam > config.maxAttachmentBlobBytes) {
  violations.push("attachment byte ceilings must be ordered team <= relay");
}
try {
  const filesystem = statfsSync(dirname(config.dataPath));
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (availableBytes < config.minimumDiskHeadroomBytes) {
    violations.push(`SQLite filesystem must have at least ${config.minimumDiskHeadroomBytes} available bytes`);
  }
} catch {
  violations.push("SQLite filesystem headroom could not be measured");
}

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

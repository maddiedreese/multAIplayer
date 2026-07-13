import { JsonFileRelayPersistence } from "./json-file-persistence.js";
import type { RelayPersistence, RelayStorageBackend } from "./persistence-types.js";
import { SqliteRelayPersistence } from "./sqlite-persistence.js";

export type { RelayPersistence, RelayStorageBackend, StoredRelayMutation } from "./persistence-types.js";
export { RelayPersistenceMigrationError, RelayStaleEpochError } from "./sqlite-persistence.js";

export function createRelayPersistence(options: {
  backend: RelayStorageBackend;
  dataPath: string;
  legacyJsonImportPath?: string | null;
}): RelayPersistence {
  return options.backend === "sqlite"
    ? new SqliteRelayPersistence(options.dataPath, options.legacyJsonImportPath ?? null)
    : new JsonFileRelayPersistence(options.dataPath);
}

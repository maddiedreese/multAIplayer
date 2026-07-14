import { JsonFileRelayPersistence } from "./json-file-persistence.js";
import type { RelayPersistence, RelayStorageBackend } from "./persistence-types.js";
import { SqliteRelayPersistence } from "./sqlite-persistence.js";

export type { RelayPersistence, RelayStorageBackend, StoredRelayMutation } from "./persistence-types.js";
export { RelayPersistenceMigrationError, RelayStaleEpochError } from "./sqlite-persistence.js";

export function createRelayPersistence(options: {
  backend: RelayStorageBackend;
  dataPath: string;
  legacyJsonImportPath?: string | null;
  recordSqliteWriteDuration?: (durationMs: number) => void;
}): RelayPersistence {
  return options.backend === "sqlite"
    ? new SqliteRelayPersistence(
        options.dataPath,
        options.legacyJsonImportPath ?? null,
        undefined,
        options.recordSqliteWriteDuration
      )
    : new JsonFileRelayPersistence(options.dataPath);
}

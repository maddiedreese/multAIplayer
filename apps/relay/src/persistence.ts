import type { RelayPersistence } from "./persistence-types.js";
import { SqliteRelayPersistence } from "./sqlite-persistence.js";

export type { RelayPersistence, StoredRelayMutation } from "./persistence-types.js";
export { RelayPersistenceMigrationError, RelayStaleEpochError } from "./sqlite-persistence.js";

export function createRelayPersistence(options: {
  dataPath: string;
  legacyJsonImportPath?: string | null;
  recordSqliteWriteDuration?: (durationMs: number) => void;
}): RelayPersistence {
  return new SqliteRelayPersistence(
    options.dataPath,
    options.legacyJsonImportPath ?? null,
    undefined,
    options.recordSqliteWriteDuration
  );
}

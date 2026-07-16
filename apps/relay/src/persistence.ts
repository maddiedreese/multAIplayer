import type { RelayPersistence } from "./persistence-types.js";
import { SqliteRelayPersistence } from "./sqlite-persistence.js";

export type { RelayPersistence, StoredRelayMutation } from "./persistence-types.js";
export { RelayStaleEpochError } from "./sqlite-persistence.js";

export function createRelayPersistence(options: {
  dataPath: string;
  sqliteWalAutoCheckpointPages?: number;
  recordSqliteWriteDuration?: (durationMs: number) => void;
}): RelayPersistence {
  return new SqliteRelayPersistence(
    options.dataPath,
    options.recordSqliteWriteDuration,
    options.sqliteWalAutoCheckpointPages
  );
}

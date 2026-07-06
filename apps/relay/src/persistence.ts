import Database from "better-sqlite3";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";

export type RelayStorageBackend = "json" | "sqlite";

export interface RelayPersistence {
  load(): Promise<unknown | null>;
  save(state: unknown): Promise<void>;
  quarantine(reason: string): Promise<void>;
}

export function createRelayPersistence(options: {
  backend: RelayStorageBackend;
  dataPath: string;
}): RelayPersistence {
  return options.backend === "sqlite"
    ? new SqliteRelayPersistence(options.dataPath)
    : new JsonFileRelayPersistence(options.dataPath);
}

class JsonFileRelayPersistence implements RelayPersistence {
  constructor(private readonly dataPath: string) {}

  async load(): Promise<unknown | null> {
    try {
      const raw = await readFile(this.dataPath, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: unknown): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const tempPath = `${this.dataPath}.${process.pid}.${nanoid(8)}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.dataPath);
  }

  async quarantine(reason: string): Promise<void> {
    await quarantinePath(this.dataPath, reason);
  }
}

class SqliteRelayPersistence implements RelayPersistence {
  constructor(private readonly dataPath: string) {}

  async load(): Promise<unknown | null> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const db = this.open();
    try {
      const row = db.prepare("select state_json from relay_snapshots where id = ?").get("current") as
        | { state_json?: unknown }
        | undefined;
      if (typeof row?.state_json !== "string") return null;
      return JSON.parse(row.state_json) as unknown;
    } finally {
      db.close();
    }
  }

  async save(state: unknown): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const db = this.open();
    try {
      const stateJson = JSON.stringify(state);
      const savedAt = isRecord(state) && typeof state.savedAt === "string"
        ? state.savedAt
        : new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          insert into relay_snapshots (id, state_json, saved_at)
          values (?, ?, ?)
          on conflict(id) do update set state_json = excluded.state_json, saved_at = excluded.saved_at
        `).run("current", stateJson, savedAt);
      })();
    } finally {
      db.close();
    }
  }

  async quarantine(reason: string): Promise<void> {
    await Promise.all([
      quarantinePath(this.dataPath, reason),
      quarantinePath(`${this.dataPath}-wal`, reason),
      quarantinePath(`${this.dataPath}-shm`, reason)
    ]);
  }

  private open(): Database.Database {
    const db = new Database(this.dataPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      create table if not exists relay_snapshots (
        id text primary key,
        state_json text not null,
        saved_at text not null
      )
    `);
    return db;
  }
}

async function quarantinePath(path: string, reason: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.corrupt-${reason}-${timestamp}`;
  try {
    await rename(path, backupPath);
    console.warn(`Moved unreadable relay store to ${backupPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to move unreadable relay store at ${path}:`, error);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

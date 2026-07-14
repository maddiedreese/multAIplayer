import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import { logRelayEvent } from "./observability.js";
import type { RelayPersistence, StoredRelayMutation } from "./persistence-types.js";
import type { RoomKey } from "./state.js";
import type { MlsRelayMessage } from "@multaiplayer/protocol";

export class JsonFileRelayPersistence implements RelayPersistence {
  readonly flushMode = "debounced";

  constructor(
    private readonly dataPath: string,
    private readonly fileOperations: JsonFilePersistenceFileOperations = { chmod, rename, writeFile }
  ) {}

  async load(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.dataPath, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: unknown): Promise<void> {
    await ensureDataDirectory(dirname(this.dataPath));
    const tempPath = `${this.dataPath}.${process.pid}.${nanoid(8)}.tmp`;
    await this.fileOperations.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await this.fileOperations.chmod(tempPath, 0o600);
    await this.fileOperations.rename(tempPath, this.dataPath);
  }

  async finalizeLoad(): Promise<void> {}
  async saveChanges(): Promise<boolean> {
    return false;
  }
  async saveMlsBacklog(): Promise<boolean> {
    return false;
  }
  async saveKeyPackages(_changes: StoredRelayMutation[], fallbackState: () => unknown): Promise<void> {
    await this.save(fallbackState());
  }
  async saveMlsMessage(
    _roomKey: RoomKey,
    _message: MlsRelayMessage,
    _pruned: string[],
    _changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ) {
    await this.save(fallbackState());
    return true;
  }
  async saveMlsCommit(
    _roomKey: RoomKey,
    _message: MlsRelayMessage,
    _pruned: string[],
    _changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ) {
    await this.save(fallbackState());
  }
  async quarantine(reason: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(this.dataPath, `${this.dataPath}.corrupt-${reason}-${timestamp}`);
      logRelayEvent("warn", "unreadable_store_quarantined");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") logRelayEvent("error", "store_quarantine_failed");
    }
  }
  close() {}
}

export interface JsonFilePersistenceFileOperations {
  chmod: typeof chmod;
  rename: typeof rename;
  writeFile: typeof writeFile;
}

async function ensureDataDirectory(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
}

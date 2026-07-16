import { saveEncryptedHistory } from "./localHistory";

interface PendingHistoryWrite {
  value: unknown;
  onError: (error: unknown) => void;
}

interface RoomHistoryWriter {
  active: Promise<void> | null;
  pending: PendingHistoryWrite | null;
}

type SaveHistory = (roomId: string, value: unknown) => Promise<void>;

export class LocalHistoryWriteQueue {
  private readonly writers = new Map<string, RoomHistoryWriter>();

  constructor(private readonly save: SaveHistory) {}

  queue(roomId: string, value: unknown, onError: (error: unknown) => void): void {
    const writer = this.writers.get(roomId) ?? { active: null, pending: null };
    this.writers.set(roomId, writer);
    const write = { value, onError };
    if (writer.active) {
      writer.pending = write;
      return;
    }
    this.start(roomId, writer, write);
  }

  async flush(roomId?: string): Promise<void> {
    while (true) {
      const active = roomId
        ? this.writers.get(roomId)?.active
        : Promise.all([...this.writers.values()].map((writer) => writer.active)).then(() => undefined);
      if (!active) return;
      await active;
      if (roomId ? !this.writers.has(roomId) : this.writers.size === 0) return;
    }
  }

  private start(roomId: string, writer: RoomHistoryWriter, write: PendingHistoryWrite) {
    writer.active = this.save(roomId, write.value)
      .catch(write.onError)
      .then(() => undefined)
      .finally(() => {
        writer.active = null;
        const pending = writer.pending;
        writer.pending = null;
        if (pending) this.start(roomId, writer, pending);
        else this.writers.delete(roomId);
      });
  }
}

const queue = new LocalHistoryWriteQueue(saveEncryptedHistory);

/** Serializes each room's native writes and coalesces bursts to the newest snapshot. */
export function queueEncryptedHistorySave(roomId: string, value: unknown, onError: (error: unknown) => void): void {
  queue.queue(roomId, value, onError);
}

export async function flushEncryptedHistorySaves(roomId?: string): Promise<void> {
  await queue.flush(roomId);
}

interface PendingHistoryWrite {
  value: unknown;
  onError: (error: unknown) => void;
  onSuccess?: () => void;
}

interface RoomHistoryWriter {
  active: Promise<void> | null;
  pending: PendingHistoryWrite | null;
}

type SaveHistory = (roomId: string, value: unknown) => Promise<void>;

export class LocalHistoryWriteQueue {
  private readonly writers = new Map<string, RoomHistoryWriter>();
  private readonly barriers = new Map<string, Promise<void>>();
  private readonly blockedRooms = new Set<string>();
  private readonly blockedPending = new Map<string, PendingHistoryWrite>();
  private readonly failures = new Map<string, unknown>();

  constructor(private readonly save: SaveHistory) {}

  queue(roomId: string, value: unknown, onError: (error: unknown) => void, onSuccess?: () => void): void {
    const write: PendingHistoryWrite = { value, onError, ...(onSuccess ? { onSuccess } : {}) };
    if (this.blockedRooms.has(roomId)) {
      this.blockedPending.set(roomId, write);
      return;
    }
    const writer = this.writers.get(roomId) ?? { active: null, pending: null };
    this.writers.set(roomId, writer);
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
      if (!active) break;
      await active;
      if (roomId ? !this.writers.has(roomId) : this.writers.size === 0) break;
    }
    const failures = roomId
      ? this.failures.has(roomId)
        ? [this.failures.get(roomId)]
        : []
      : [...this.failures.values()];
    if (roomId) this.failures.delete(roomId);
    else this.failures.clear();
    if (failures.length) throw new AggregateError(failures, "One or more encrypted local-history writes failed.");
  }

  /** Retains the newest snapshot until an exclusive destructive operation succeeds. */
  async withBarrier<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
    this.blockedRooms.add(roomId);
    const writer = this.writers.get(roomId);
    if (writer?.pending) {
      this.blockedPending.set(roomId, writer.pending);
      writer.pending = null;
    }
    const previous = this.barriers.get(roomId) ?? Promise.resolve();
    let result!: T;
    const runBarrier = async () => {
      const active = this.writers.get(roomId)?.active;
      if (active) await active;
      result = await operation();
      this.failures.delete(roomId);
      // A successful destructive operation makes every snapshot observed
      // before or during it obsolete. Failed operations retain the newest
      // snapshot so live state is not silently lost.
      this.blockedPending.delete(roomId);
    };
    const barrier = previous.then(runBarrier, runBarrier);
    this.barriers.set(roomId, barrier);
    try {
      await barrier;
      return result;
    } finally {
      if (this.barriers.get(roomId) === barrier) {
        this.barriers.delete(roomId);
        this.blockedRooms.delete(roomId);
        const pending = this.blockedPending.get(roomId);
        this.blockedPending.delete(roomId);
        if (pending) this.queue(roomId, pending.value, pending.onError, pending.onSuccess);
      }
    }
  }

  private start(roomId: string, writer: RoomHistoryWriter, write: PendingHistoryWrite) {
    writer.active = this.save(roomId, write.value)
      .then(
        () => {
          this.failures.delete(roomId);
          write.onSuccess?.();
        },
        (error) => {
          this.failures.set(roomId, error);
          write.onError(error);
        }
      )
      .then(() => undefined)
      .finally(() => {
        writer.active = null;
        const pending = writer.pending;
        writer.pending = null;
        if (pending && !this.blockedRooms.has(roomId)) this.start(roomId, writer, pending);
        else this.writers.delete(roomId);
      });
  }
}

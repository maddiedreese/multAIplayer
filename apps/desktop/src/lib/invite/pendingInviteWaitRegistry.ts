interface PendingInviteWaitEntry {
  owner: symbol | null;
  observers: number;
  settled: boolean;
}

export class PendingInviteWaitOwnership {
  private released = false;

  constructor(
    private readonly registry: PendingInviteWaitRegistry,
    readonly requestId: string,
    private readonly token: symbol
  ) {}

  settle(): void {
    if (this.released) return;
    this.registry.settle(this.requestId, this.token);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.registry.releaseOwner(this.requestId, this.token);
  }
}

export class PendingInviteWaitObserver {
  private released = false;

  constructor(
    private readonly registry: PendingInviteWaitRegistry,
    readonly requestId: string
  ) {}

  claim(): PendingInviteWaitOwnership | null {
    if (this.released) return null;
    this.released = true;
    return this.registry.claimObserver(this.requestId);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.registry.releaseObserver(this.requestId);
  }
}

export class PendingInviteWaitScan {
  private released = false;

  constructor(private readonly registry: PendingInviteWaitRegistry) {}

  observe(requestIds: readonly string[]): Map<string, PendingInviteWaitObserver> {
    if (this.released) throw new Error("Pending invite scan is already released.");
    return this.registry.observe(requestIds);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.registry.releaseScan();
  }
}

export class PendingInviteWaitRegistry {
  private readonly entries = new Map<string, PendingInviteWaitEntry>();
  private scans = 0;

  beginScan(): PendingInviteWaitScan {
    this.scans += 1;
    return new PendingInviteWaitScan(this);
  }

  claim(requestId: string): PendingInviteWaitOwnership | null {
    const entry = this.entry(requestId);
    if (entry.owner || entry.settled) return null;
    const token = Symbol(requestId);
    entry.owner = token;
    return new PendingInviteWaitOwnership(this, requestId, token);
  }

  trackedCount(): number {
    return this.entries.size;
  }

  observe(requestIds: readonly string[]): Map<string, PendingInviteWaitObserver> {
    const observers = new Map<string, PendingInviteWaitObserver>();
    for (const requestId of new Set(requestIds)) {
      this.entry(requestId).observers += 1;
      observers.set(requestId, new PendingInviteWaitObserver(this, requestId));
    }
    return observers;
  }

  claimObserver(requestId: string): PendingInviteWaitOwnership | null {
    const entry = this.entries.get(requestId);
    if (!entry || entry.observers === 0) return null;
    entry.observers -= 1;
    if (entry.owner || entry.settled) {
      this.cleanup(requestId, entry);
      return null;
    }
    const token = Symbol(requestId);
    entry.owner = token;
    return new PendingInviteWaitOwnership(this, requestId, token);
  }

  releaseObserver(requestId: string): void {
    const entry = this.entries.get(requestId);
    if (!entry || entry.observers === 0) return;
    entry.observers -= 1;
    this.cleanup(requestId, entry);
  }

  settle(requestId: string, token: symbol): void {
    const entry = this.entries.get(requestId);
    if (entry?.owner === token) entry.settled = true;
  }

  releaseOwner(requestId: string, token: symbol): void {
    const entry = this.entries.get(requestId);
    if (!entry || entry.owner !== token) return;
    entry.owner = null;
    this.cleanup(requestId, entry);
  }

  releaseScan(): void {
    if (this.scans === 0) return;
    this.scans -= 1;
    if (this.scans > 0) return;
    for (const [requestId, entry] of this.entries) this.cleanup(requestId, entry);
  }

  private entry(requestId: string): PendingInviteWaitEntry {
    const existing = this.entries.get(requestId);
    if (existing) return existing;
    const created = { owner: null, observers: 0, settled: false };
    this.entries.set(requestId, created);
    return created;
  }

  private cleanup(requestId: string, entry: PendingInviteWaitEntry): void {
    if (entry.owner || entry.observers > 0 || (entry.settled && this.scans > 0)) return;
    this.entries.delete(requestId);
  }
}

export async function runOwnedPendingInviteRecovery<T>(options: {
  observer: PendingInviteWaitObserver;
  load: () => Promise<T>;
  recover: (value: T, ownership: PendingInviteWaitOwnership) => "release" | "transfer";
  onError: (error: unknown, ownership: PendingInviteWaitOwnership) => Promise<void>;
}): Promise<void> {
  const ownership = options.observer.claim();
  if (!ownership) return;
  let transferred = false;
  try {
    const value = await options.load();
    transferred = options.recover(value, ownership) === "transfer";
  } catch (error) {
    await options.onError(error, ownership);
  } finally {
    if (!transferred) ownership.release();
  }
}

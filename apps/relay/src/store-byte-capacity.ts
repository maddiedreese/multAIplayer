export class RelayStoreByteCapacityError extends Error {
  override readonly name = "RelayStoreByteCapacityError";

  constructor(
    readonly resource: "mls_backlog" | "attachment_blobs",
    readonly maximumBytes: number,
    readonly scope: "relay" | "team" | "room",
    readonly scopeId?: string
  ) {
    super(`${resource} retained bytes reached the configured ${scope} ceiling of ${maximumBytes} bytes.`);
  }
}

export interface RelayStoreByteLimits {
  mlsBacklog: { global: number; perTeam: number; perRoom: number };
  attachmentBlobs: { global: number; perTeam: number };
}

export interface RetainedByteWeight {
  resource: "mls_backlog" | "attachment_blobs";
  bytes: number;
  teamId: string;
  roomId?: string;
}

export class DurableByteCapacity {
  private mlsBacklogBytes = 0;
  private attachmentBlobBytes = 0;
  private readonly mlsByTeam = new Map<string, number>();
  private readonly mlsByRoom = new Map<string, number>();
  private readonly attachmentsByTeam = new Map<string, number>();

  constructor(private readonly limits: RelayStoreByteLimits) {
    if (
      limits.mlsBacklog.perRoom > limits.mlsBacklog.perTeam ||
      limits.mlsBacklog.perTeam > limits.mlsBacklog.global ||
      limits.attachmentBlobs.perTeam > limits.attachmentBlobs.global
    ) {
      throw new Error("Relay byte capacity scopes must be ordered room <= team <= relay.");
    }
  }

  replace(previous: RetainedByteWeight | null, next: RetainedByteWeight | null) {
    if (
      previous?.resource === next?.resource &&
      previous?.teamId === next?.teamId &&
      previous?.roomId === next?.roomId
    ) {
      this.adjust(next!.resource, next!.bytes - previous!.bytes, next!.teamId, next!.roomId);
      return;
    }
    if (previous) this.adjust(previous.resource, -previous.bytes, previous.teamId, previous.roomId);
    try {
      if (next) this.adjust(next.resource, next.bytes, next.teamId, next.roomId);
    } catch (error) {
      if (previous) this.adjust(previous.resource, previous.bytes, previous.teamId, previous.roomId);
      throw error;
    }
  }

  private assertCanAdjust(resource: RetainedByteWeight["resource"], delta: number, teamId: string, roomId?: string) {
    if (delta <= 0) return;
    if (resource === "mls_backlog") {
      if (this.mlsBacklogBytes + delta > this.limits.mlsBacklog.global)
        throw new RelayStoreByteCapacityError(resource, this.limits.mlsBacklog.global, "relay");
      if ((this.mlsByTeam.get(teamId) ?? 0) + delta > this.limits.mlsBacklog.perTeam)
        throw new RelayStoreByteCapacityError(resource, this.limits.mlsBacklog.perTeam, "team", teamId);
      if (roomId && (this.mlsByRoom.get(roomId) ?? 0) + delta > this.limits.mlsBacklog.perRoom)
        throw new RelayStoreByteCapacityError(resource, this.limits.mlsBacklog.perRoom, "room", roomId);
    } else {
      if (this.attachmentBlobBytes + delta > this.limits.attachmentBlobs.global)
        throw new RelayStoreByteCapacityError(resource, this.limits.attachmentBlobs.global, "relay");
      if ((this.attachmentsByTeam.get(teamId) ?? 0) + delta > this.limits.attachmentBlobs.perTeam)
        throw new RelayStoreByteCapacityError(resource, this.limits.attachmentBlobs.perTeam, "team", teamId);
    }
  }

  private adjust(resource: RetainedByteWeight["resource"], delta: number, teamId: string, roomId?: string) {
    this.assertCanAdjust(resource, delta, teamId, roomId);
    if (resource === "mls_backlog") {
      this.mlsBacklogBytes += delta;
      adjustCounter(this.mlsByTeam, teamId, delta);
      if (roomId) adjustCounter(this.mlsByRoom, roomId, delta);
    } else {
      this.attachmentBlobBytes += delta;
      adjustCounter(this.attachmentsByTeam, teamId, delta);
    }
  }

  snapshot() {
    return { mlsBacklogBytes: this.mlsBacklogBytes, attachmentBlobBytes: this.attachmentBlobBytes };
  }
}

function adjustCounter(map: Map<string, number>, key: string, delta: number) {
  const next = (map.get(key) ?? 0) + delta;
  if (next === 0) map.delete(key);
  else map.set(key, next);
}

export function retainedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

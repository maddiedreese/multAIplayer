import type { WebSocket } from "ws";
import {
  DurableByteCapacity,
  retainedJsonBytes,
  type RelayStoreByteLimits,
  type RetainedByteWeight
} from "./store-byte-capacity.js";

export { RelayStoreByteCapacityError, type RelayStoreByteLimits } from "./store-byte-capacity.js";
import type {
  AttachmentBlobRecord,
  DeviceRecord,
  InviteRecord,
  InviteJoinRequestRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  MlsRelayMessage,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord
} from "@multaiplayer/protocol";

export type RoomKey = `${string}:${string}`;

export type RelayStoreMutationEntity =
  | "authSessions"
  | "accountRestrictions"
  | "accountQuotaRecords"
  | "teams"
  | "rooms"
  | "invites"
  | "inviteRequests"
  | "inviteResponses"
  | "inviteAckReceipts"
  | "acceptedMessageReceipts"
  | "devices"
  | "keyPackages"
  | "consumedKeyPackages"
  | "attachmentBlobs"
  | "teamMembers"
  | "mlsBacklog";

export interface RelayStoreMutation {
  entity: RelayStoreMutationEntity;
  key: string;
}

export interface AuthSession {
  /** In-memory copy used to verify digest-keyed lookups independently. Never serialized as a bearer token. */
  sessionIdHash: string;
  user: {
    id: string;
    login: string;
    name?: string;
    avatarUrl?: string;
  };
  expiresAt: number;
}

/** Session identity supplied by an authentication route before the bearer token is hashed. */
export type NewAuthSession = Omit<AuthSession, "sessionIdHash">;

export interface ClientSession {
  socket: WebSocket;
  authSession?: AuthSession;
  rateClientId: string;
  rateClientIds?: string[];
  teamId?: string;
  roomId?: string;
  userId?: string;
  deviceId?: string;
  deviceSessionToken?: string;
  subscribedTeamIds: Set<string>;
  workspaceSubscribed: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface PresenceRecord {
  teamId: string;
  roomId: string;
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string;
  publicKeyFingerprint?: string;
}

export interface RateLimitRecord {
  count: number;
  resetAt: number;
}
export interface TokenBucketRecord {
  tokens: number;
  updatedAt: number;
  lastSeenAt: number;
}
export interface ByteQuotaRecord {
  bytes: number;
  resetAt: number;
}
export interface DeviceChallengeRecord {
  userId: string;
  deviceId: string;
  expiresAt: number;
}
export interface DeviceSessionRecord {
  token: string;
  userId: string;
  deviceId: string;
  expiresAt: number;
}
export interface AcceptedMessageReceipt {
  roomKey: RoomKey;
  messageId: string;
  messageType: "application" | "commit";
  senderUserId: string;
  senderDeviceId: string;
  parentEpoch: number;
  digest: string;
  acceptedAt: string;
}
export interface InviteAckReceipt {
  inviteId: string;
  requestId: string;
  teamId: string;
  requesterUserId: string;
  requesterDeviceId: string;
  keyPackageHash: string;
  status: "approved" | "denied";
  acknowledgedAt: string;
  expiresAt: string;
}
export interface ConsumedKeyPackageRecord {
  keyPackageHash: string;
  /** New public-alpha tombstones retain their originating team for tenant capacity accounting. */
  teamId?: string;
  /** Account deletion removes userId and deviceId; the stable hash remains for one-shot enforcement. */
  userId?: string;
  deviceId?: string;
  consumedAt: string;
}

export interface AccountRestriction {
  userId: string;
  reasonCode: string;
  createdAt: string;
  expiresAt?: string;
}

export interface AccountQuotaRecord {
  key: string;
  userId: string;
  quota: "daily_team_creations" | "daily_room_creations" | "attachment_upload_bytes";
  used: number;
  resetAt: number;
}

export interface RelayStore {
  sessions: Map<WebSocket, ClientSession>;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  mlsBacklog: Map<RoomKey, MlsRelayMessage[]>;
  authSessions: Map<string, AuthSession>;
  accountRestrictions: Map<string, AccountRestriction>;
  accountQuotaRecords: Map<string, AccountQuotaRecord>;
  teams: Map<string, TeamRecord>;
  rooms: Map<string, RoomRecord>;
  invites: Map<string, InviteRecord>;
  inviteRequests: Map<string, InviteJoinRequestRecord>;
  inviteResponses: Map<string, InviteResponseRecord>;
  inviteAckReceipts: Map<string, InviteAckReceipt>;
  acceptedMessageReceipts: Map<string, AcceptedMessageReceipt>;
  devices: Map<string, DeviceRecord>;
  keyPackages: Map<string, KeyPackageRecord>;
  consumedKeyPackages: Map<string, ConsumedKeyPackageRecord>;
  attachmentBlobs: Map<string, AttachmentBlobRecord>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  rateLimitStore: Map<string, TokenBucketRecord>;
  dailyTeamCreationCounts: Map<string, RateLimitRecord>;
  dailyRoomCreationCounts: Map<string, RateLimitRecord>;
  attachmentBlobUploadByteCounts: Map<string, ByteQuotaRecord>;
  deviceChallenges: Map<string, DeviceChallengeRecord>;
  deviceSessions: Map<string, DeviceSessionRecord>;
  allTeams(): TeamRecord[];
  getTeam(teamId: string): TeamRecord | undefined;
  hasTeam(teamId: string): boolean;
  setTeam(team: TeamRecord): void;
  getTeamMembers(teamId: string): Map<string, TeamMemberRecord> | undefined;
  setTeamMembers(teamId: string, members: Map<string, TeamMemberRecord>): void;
  getTeamMember(teamId: string, userId: string): TeamMemberRecord | undefined;
  hasTeamMember(teamId: string, userId: string): boolean;
  teamIdsForMember(userId: string): Set<string>;
  allRooms(): RoomRecord[];
  getRoom(roomId: string): RoomRecord | undefined;
  setRoom(room: RoomRecord): void;
  getInvite(inviteId: string): InviteRecord | undefined;
  setInvite(invite: InviteRecord): void;
  deleteInvite(inviteId: string): boolean;
  getAttachmentBlob(blobId: string): AttachmentBlobRecord | undefined;
  setAttachmentBlob(blob: AttachmentBlobRecord): void;
  deleteAttachmentBlob(blobId: string): boolean;
  getDevice(userId: string, deviceId: string): DeviceRecord | undefined;
  setDevice(device: DeviceRecord): void;
  keyPackagesForDevice(userId: string, deviceId: string): KeyPackageRecord[];
  setKeyPackage(keyPackage: KeyPackageRecord): void;
  deleteKeyPackage(id: string): boolean;
  getMlsBacklog(roomKey: RoomKey): MlsRelayMessage[] | undefined;
  setMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void;
  allMlsBacklogEntries(): Array<[RoomKey, MlsRelayMessage[]]>;
  drainDurableMutations(): RelayStoreMutation[];
  discardDurableMutations(): void;
  retainedByteUsage(): {
    mlsBacklogBytes: number;
    attachmentBlobBytes: number;
  };
}

export class RelayStoreCapacityError extends Error {
  override readonly name = "RelayStoreCapacityError";

  constructor(
    readonly maxDurableEntries: number,
    readonly teamId?: string
  ) {
    super(
      teamId
        ? `Team durable in-memory state reached its configured ceiling of ${maxDurableEntries} entries.`
        : `Relay durable in-memory state reached its configured ceiling of ${maxDurableEntries} entries.`
    );
  }
}

const defaultByteLimits: RelayStoreByteLimits = {
  mlsBacklog: { global: 50_000_000, perTeam: 25_000_000, perRoom: 5_000_000 },
  attachmentBlobs: { global: 100_000_000, perTeam: 50_000_000 }
};

export class InMemoryRelayStore implements RelayStore {
  private durableMutations: RelayStoreMutation[] = [];
  private readonly capacity = new DurableEntryCapacity();
  private readonly byteCapacity: DurableByteCapacity;
  readonly sessions = new Map<WebSocket, ClientSession>();
  readonly roomSockets = new Map<RoomKey, Set<WebSocket>>();
  readonly teamSockets = new Map<string, Set<WebSocket>>();
  readonly workspaceSockets = new Set<WebSocket>();
  readonly roomPresence = new Map<RoomKey, Map<string, PresenceRecord>>();
  readonly mlsBacklog: Map<RoomKey, MlsRelayMessage[]>;
  readonly authSessions = this.trackedMap<string, AuthSession>("authSessions");
  readonly accountRestrictions = this.trackedMap<string, AccountRestriction>("accountRestrictions");
  readonly accountQuotaRecords = this.trackedMap<string, AccountQuotaRecord>("accountQuotaRecords");
  readonly teams = this.trackedMap<string, TeamRecord>("teams", (value) => value.id);
  readonly rooms = this.trackedMap<string, RoomRecord>("rooms", (value) => value.teamId);
  readonly invites = this.trackedMap<string, InviteRecord>("invites", (value) => value.teamId);
  readonly inviteRequests = this.trackedMap<string, InviteJoinRequestRecord>("inviteRequests");
  readonly inviteResponses = this.trackedMap<string, InviteResponseRecord>(
    "inviteResponses",
    (value) => value.responseBinding.teamId
  );
  readonly inviteAckReceipts = this.trackedMap<string, InviteAckReceipt>("inviteAckReceipts", (value) => value.teamId);
  readonly acceptedMessageReceipts = this.trackedMap<string, AcceptedMessageReceipt>(
    "acceptedMessageReceipts",
    (value) => teamFromRoomKey(value.roomKey)
  );
  readonly devices = this.trackedMap<string, DeviceRecord>("devices");
  readonly keyPackages = this.trackedMap<string, KeyPackageRecord>("keyPackages");
  readonly consumedKeyPackages = this.trackedMap<string, ConsumedKeyPackageRecord>(
    "consumedKeyPackages",
    (value) => value.teamId ?? null
  );
  readonly attachmentBlobs: Map<string, AttachmentBlobRecord>;
  readonly teamMembers: TeamMemberCollectionMap;
  readonly rateLimitStore = new Map<string, TokenBucketRecord>();
  readonly dailyTeamCreationCounts = new Map<string, RateLimitRecord>();
  readonly dailyRoomCreationCounts = new Map<string, RateLimitRecord>();
  readonly attachmentBlobUploadByteCounts = new Map<string, ByteQuotaRecord>();
  readonly deviceChallenges = new Map<string, DeviceChallengeRecord>();
  readonly deviceSessions = new Map<string, DeviceSessionRecord>();

  constructor(
    maxDurableEntries = 250_000,
    maxDurableEntriesPerTeam = maxDurableEntries,
    byteLimits: RelayStoreByteLimits = defaultByteLimits
  ) {
    this.capacity.configure(maxDurableEntries, maxDurableEntriesPerTeam);
    this.byteCapacity = new DurableByteCapacity(byteLimits);
    this.mlsBacklog = this.trackedMap<RoomKey, MlsRelayMessage[]>(
      "mlsBacklog",
      (_value, key) => teamFromRoomKey(key),
      (value, key) => ({
        resource: "mls_backlog",
        bytes: retainedJsonBytes(value),
        teamId: teamFromRoomKey(key),
        roomId: key
      })
    );
    this.attachmentBlobs = this.trackedMap<string, AttachmentBlobRecord>(
      "attachmentBlobs",
      (value) => value.teamId,
      (value) => ({
        resource: "attachment_blobs",
        bytes: Buffer.byteLength(value.sealedBlob, "utf8"),
        teamId: value.teamId
      })
    );
    this.teamMembers = new TeamMemberCollectionMap(
      (key) => this.durableMutations.push({ entity: "teamMembers", key }),
      this.capacity
    );
  }

  allTeams(): TeamRecord[] {
    return Array.from(this.teams.values());
  }

  getTeam(teamId: string): TeamRecord | undefined {
    return this.teams.get(teamId);
  }

  hasTeam(teamId: string): boolean {
    return this.teams.has(teamId);
  }

  setTeam(team: TeamRecord): void {
    this.teams.set(team.id, team);
  }

  getTeamMembers(teamId: string): Map<string, TeamMemberRecord> | undefined {
    return this.teamMembers.get(teamId);
  }

  setTeamMembers(teamId: string, members: Map<string, TeamMemberRecord>): void {
    this.teamMembers.set(teamId, members);
  }

  getTeamMember(teamId: string, userId: string): TeamMemberRecord | undefined {
    return this.teamMembers.get(teamId)?.get(userId);
  }

  hasTeamMember(teamId: string, userId: string): boolean {
    return this.teamMembers.get(teamId)?.has(userId) ?? false;
  }

  teamIdsForMember(userId: string): Set<string> {
    const visible = new Set<string>();
    for (const [teamId, members] of this.teamMembers.entries()) {
      if (members.has(userId)) visible.add(teamId);
    }
    return visible;
  }

  allRooms(): RoomRecord[] {
    return Array.from(this.rooms.values());
  }

  getRoom(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  setRoom(room: RoomRecord): void {
    this.rooms.set(room.id, room);
  }

  getInvite(inviteId: string): InviteRecord | undefined {
    return this.invites.get(inviteId);
  }

  setInvite(invite: InviteRecord): void {
    this.invites.set(invite.id, invite);
  }

  deleteInvite(inviteId: string): boolean {
    return this.invites.delete(inviteId);
  }

  getAttachmentBlob(blobId: string): AttachmentBlobRecord | undefined {
    return this.attachmentBlobs.get(blobId);
  }

  setAttachmentBlob(blob: AttachmentBlobRecord): void {
    this.attachmentBlobs.set(blob.id, blob);
  }

  deleteAttachmentBlob(blobId: string): boolean {
    return this.attachmentBlobs.delete(blobId);
  }

  getDevice(userId: string, deviceId: string): DeviceRecord | undefined {
    return this.devices.get(deviceKey(userId, deviceId));
  }

  setDevice(device: DeviceRecord): void {
    this.devices.set(deviceKey(device.userId, device.deviceId), device);
  }

  keyPackagesForDevice(userId: string, deviceId: string): KeyPackageRecord[] {
    return Array.from(this.keyPackages.values()).filter((item) => item.userId === userId && item.deviceId === deviceId);
  }

  setKeyPackage(keyPackage: KeyPackageRecord): void {
    this.keyPackages.set(keyPackage.id, keyPackage);
  }

  deleteKeyPackage(id: string): boolean {
    return this.keyPackages.delete(id);
  }

  getMlsBacklog(roomKey: RoomKey): MlsRelayMessage[] | undefined {
    return this.mlsBacklog.get(roomKey);
  }

  setMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void {
    this.mlsBacklog.set(roomKey, messages);
  }

  allMlsBacklogEntries(): Array<[RoomKey, MlsRelayMessage[]]> {
    return Array.from(this.mlsBacklog.entries());
  }

  drainDurableMutations(): RelayStoreMutation[] {
    const mutations = this.durableMutations;
    this.durableMutations = [];
    return mutations;
  }

  discardDurableMutations(): void {
    this.durableMutations = [];
  }

  retainedByteUsage() {
    return this.byteCapacity.snapshot();
  }

  private trackedMap<Key extends string, Value>(
    entity: RelayStoreMutationEntity,
    teamIdForEntry: (value: Value, key: Key) => string | null = () => null,
    byteWeight?: (value: Value, key: Key) => RetainedByteWeight
  ): Map<Key, Value> {
    return new DurableMutationMap<Key, Value>(
      (key) => this.durableMutations.push({ entity, key }),
      this.capacity,
      teamIdForEntry,
      this.byteCapacity,
      byteWeight
    );
  }
}

export function createRelayStore(
  maxDurableEntries = 250_000,
  maxDurableEntriesPerTeam = maxDurableEntries,
  byteLimits: RelayStoreByteLimits = defaultByteLimits
): RelayStore {
  return new InMemoryRelayStore(maxDurableEntries, maxDurableEntriesPerTeam, byteLimits);
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

class DurableMutationMap<Key extends string, Value> extends Map<Key, Value> {
  constructor(
    private readonly onMutation: (key: string) => void,
    private readonly capacity: DurableEntryCapacity,
    private readonly teamIdForEntry: (value: Value, key: Key) => string | null = () => null,
    private readonly byteCapacity?: DurableByteCapacity,
    private readonly byteWeight?: (value: Value, key: Key) => RetainedByteWeight
  ) {
    super();
  }

  override set(key: Key, value: Value): this {
    const previous = this.get(key);
    this.byteCapacity?.replace(
      previous && this.byteWeight ? this.byteWeight(previous, key) : null,
      this.byteWeight?.(value, key) ?? null
    );
    try {
      if (previous === undefined) this.capacity.claim(this.teamIdForEntry(value, key));
      else this.capacity.move(this.teamIdForEntry(previous, key), this.teamIdForEntry(value, key));
      super.set(key, value);
      this.onMutation(key);
      return this;
    } catch (error) {
      this.byteCapacity?.replace(
        this.byteWeight?.(value, key) ?? null,
        previous && this.byteWeight ? this.byteWeight(previous, key) : null
      );
      throw error;
    }
  }

  override delete(key: Key): boolean {
    const previous = this.get(key);
    const deleted = super.delete(key);
    if (deleted && previous !== undefined) {
      if (this.byteCapacity && this.byteWeight) this.byteCapacity.replace(this.byteWeight(previous, key), null);
      this.capacity.release(this.teamIdForEntry(previous, key));
      this.onMutation(key);
    }
    return deleted;
  }

  override clear(): void {
    const entries = Array.from(this.entries());
    super.clear();
    for (const [key, value] of entries) {
      if (this.byteCapacity && this.byteWeight) this.byteCapacity.replace(this.byteWeight(value, key), null);
      this.capacity.release(this.teamIdForEntry(value, key));
      this.onMutation(key);
    }
  }
}

class TeamMemberCollectionMap extends Map<string, Map<string, TeamMemberRecord>> {
  constructor(
    private readonly onTeamMutation: (teamId: string) => void,
    private readonly capacity: DurableEntryCapacity
  ) {
    super();
  }

  override set(teamId: string, members: Map<string, TeamMemberRecord>): this {
    const previousSize = this.get(teamId)?.size ?? 0;
    this.capacity.adjust(members.size - previousSize + (this.has(teamId) ? 0 : 1), teamId);
    const trackedMembers = new DurableMutationMap<string, TeamMemberRecord>(
      () => this.onTeamMutation(teamId),
      this.capacity,
      () => teamId
    );
    for (const [userId, member] of members) Map.prototype.set.call(trackedMembers, userId, member);
    Map.prototype.set.call(this, teamId, trackedMembers);
    this.onTeamMutation(teamId);
    return this;
  }

  override delete(teamId: string): boolean {
    const members = this.get(teamId);
    const deleted = super.delete(teamId);
    if (deleted) {
      this.capacity.adjust(-(1 + (members?.size ?? 0)), teamId);
      this.onTeamMutation(teamId);
    }
    return deleted;
  }

  override clear(): void {
    for (const teamId of Array.from(this.keys())) this.delete(teamId);
  }
}

class DurableEntryCapacity {
  private used = 0;
  private readonly usedByTeam = new Map<string, number>();
  private maximum = Number.POSITIVE_INFINITY;
  private maximumPerTeam = Number.POSITIVE_INFINITY;

  configure(maximum: number, maximumPerTeam: number) {
    this.maximum = maximum;
    this.maximumPerTeam = maximumPerTeam;
  }

  adjust(delta: number, teamId: string | null = null) {
    if (delta > 0 && this.used + delta > this.maximum) throw new RelayStoreCapacityError(this.maximum);
    const teamUsed = teamId ? (this.usedByTeam.get(teamId) ?? 0) : 0;
    if (teamId && delta > 0 && teamUsed + delta > this.maximumPerTeam) {
      throw new RelayStoreCapacityError(this.maximumPerTeam, teamId);
    }
    this.used += delta;
    if (teamId) {
      const next = teamUsed + delta;
      if (next === 0) this.usedByTeam.delete(teamId);
      else this.usedByTeam.set(teamId, next);
    }
  }

  claim(teamId: string | null = null) {
    this.adjust(1, teamId);
  }

  release(teamId: string | null = null) {
    this.adjust(-1, teamId);
  }

  move(fromTeamId: string | null, toTeamId: string | null) {
    if (fromTeamId === toTeamId) return;
    const toUsed = toTeamId ? (this.usedByTeam.get(toTeamId) ?? 0) : 0;
    if (toTeamId && toUsed + 1 > this.maximumPerTeam) {
      throw new RelayStoreCapacityError(this.maximumPerTeam, toTeamId);
    }
    if (fromTeamId) {
      const next = (this.usedByTeam.get(fromTeamId) ?? 0) - 1;
      if (next === 0) this.usedByTeam.delete(fromTeamId);
      else this.usedByTeam.set(fromTeamId, next);
    }
    if (toTeamId) this.usedByTeam.set(toTeamId, toUsed + 1);
  }
}

function teamFromRoomKey(key: RoomKey): string {
  return key.slice(0, key.indexOf(":"));
}

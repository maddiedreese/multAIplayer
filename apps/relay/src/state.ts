import type { WebSocket } from "ws";
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
  | "teams"
  | "rooms"
  | "invites"
  | "inviteRequests"
  | "inviteResponses"
  | "inviteAckReceipts"
  | "acceptedMessageReceipts"
  | "devices"
  | "keyPackages"
  | "attachmentBlobs"
  | "appliedDeletionLedgerEntries"
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
export interface AppliedDeletionLedgerEntry {
  entryId: string;
  appliedAt: string;
}

export interface RelayStore {
  sessions: Map<WebSocket, ClientSession>;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  mlsBacklog: Map<RoomKey, MlsRelayMessage[]>;
  authSessions: Map<string, AuthSession>;
  teams: Map<string, TeamRecord>;
  rooms: Map<string, RoomRecord>;
  invites: Map<string, InviteRecord>;
  inviteRequests: Map<string, InviteJoinRequestRecord>;
  inviteResponses: Map<string, InviteResponseRecord>;
  inviteAckReceipts: Map<string, InviteAckReceipt>;
  acceptedMessageReceipts: Map<string, AcceptedMessageReceipt>;
  devices: Map<string, DeviceRecord>;
  keyPackages: Map<string, KeyPackageRecord>;
  attachmentBlobs: Map<string, AttachmentBlobRecord>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  rateLimitStore: Map<string, RateLimitRecord>;
  dailyTeamCreationCounts: Map<string, RateLimitRecord>;
  dailyRoomCreationCounts: Map<string, RateLimitRecord>;
  attachmentBlobUploadByteCounts: Map<string, ByteQuotaRecord>;
  deviceChallenges: Map<string, DeviceChallengeRecord>;
  deviceSessions: Map<string, DeviceSessionRecord>;
  appliedDeletionLedgerEntries: Map<string, AppliedDeletionLedgerEntry>;
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
}

export class InMemoryRelayStore implements RelayStore {
  private durableMutations: RelayStoreMutation[] = [];
  readonly sessions = new Map<WebSocket, ClientSession>();
  readonly roomSockets = new Map<RoomKey, Set<WebSocket>>();
  readonly teamSockets = new Map<string, Set<WebSocket>>();
  readonly workspaceSockets = new Set<WebSocket>();
  readonly roomPresence = new Map<RoomKey, Map<string, PresenceRecord>>();
  readonly mlsBacklog = this.trackedMap<RoomKey, MlsRelayMessage[]>("mlsBacklog");
  readonly authSessions = this.trackedMap<string, AuthSession>("authSessions");
  readonly teams = this.trackedMap<string, TeamRecord>("teams");
  readonly rooms = this.trackedMap<string, RoomRecord>("rooms");
  readonly invites = this.trackedMap<string, InviteRecord>("invites");
  readonly inviteRequests = this.trackedMap<string, InviteJoinRequestRecord>("inviteRequests");
  readonly inviteResponses = this.trackedMap<string, InviteResponseRecord>("inviteResponses");
  readonly inviteAckReceipts = this.trackedMap<string, InviteAckReceipt>("inviteAckReceipts");
  readonly acceptedMessageReceipts = this.trackedMap<string, AcceptedMessageReceipt>("acceptedMessageReceipts");
  readonly devices = this.trackedMap<string, DeviceRecord>("devices");
  readonly keyPackages = this.trackedMap<string, KeyPackageRecord>("keyPackages");
  readonly attachmentBlobs = this.trackedMap<string, AttachmentBlobRecord>("attachmentBlobs");
  readonly teamMembers = new TeamMemberCollectionMap((key) =>
    this.durableMutations.push({ entity: "teamMembers", key })
  );
  readonly rateLimitStore = new Map<string, RateLimitRecord>();
  readonly dailyTeamCreationCounts = new Map<string, RateLimitRecord>();
  readonly dailyRoomCreationCounts = new Map<string, RateLimitRecord>();
  readonly attachmentBlobUploadByteCounts = new Map<string, ByteQuotaRecord>();
  readonly deviceChallenges = new Map<string, DeviceChallengeRecord>();
  readonly deviceSessions = new Map<string, DeviceSessionRecord>();
  readonly appliedDeletionLedgerEntries = this.trackedMap<string, AppliedDeletionLedgerEntry>(
    "appliedDeletionLedgerEntries"
  );

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

  private trackedMap<Key extends string, Value>(entity: RelayStoreMutationEntity): Map<Key, Value> {
    return new DurableMutationMap<Key, Value>((key) => this.durableMutations.push({ entity, key }));
  }
}

export function createRelayStore(): RelayStore {
  return new InMemoryRelayStore();
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

class DurableMutationMap<Key extends string, Value> extends Map<Key, Value> {
  constructor(private readonly onMutation: (key: string) => void) {
    super();
  }

  override set(key: Key, value: Value): this {
    super.set(key, value);
    this.onMutation(key);
    return this;
  }

  override delete(key: Key): boolean {
    const deleted = super.delete(key);
    if (deleted) this.onMutation(key);
    return deleted;
  }

  override clear(): void {
    const keys = Array.from(this.keys());
    super.clear();
    for (const key of keys) this.onMutation(key);
  }
}

class TeamMemberCollectionMap extends DurableMutationMap<string, Map<string, TeamMemberRecord>> {
  constructor(private readonly onTeamMutation: (teamId: string) => void) {
    super(onTeamMutation);
  }

  override set(teamId: string, members: Map<string, TeamMemberRecord>): this {
    const trackedMembers = new DurableMutationMap<string, TeamMemberRecord>(() => this.onTeamMutation(teamId));
    for (const [userId, member] of members) Map.prototype.set.call(trackedMembers, userId, member);
    return super.set(teamId, trackedMembers);
  }
}

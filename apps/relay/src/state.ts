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

export interface AuthSession {
  accessToken: string;
  user: {
    id: string;
    login: string;
    name?: string;
    avatarUrl?: string;
  };
  expiresAt: number;
}

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
}

export class InMemoryRelayStore implements RelayStore {
  readonly sessions = new Map<WebSocket, ClientSession>();
  readonly roomSockets = new Map<RoomKey, Set<WebSocket>>();
  readonly teamSockets = new Map<string, Set<WebSocket>>();
  readonly workspaceSockets = new Set<WebSocket>();
  readonly roomPresence = new Map<RoomKey, Map<string, PresenceRecord>>();
  readonly mlsBacklog = new Map<RoomKey, MlsRelayMessage[]>();
  readonly authSessions = new Map<string, AuthSession>();
  readonly teams = new Map<string, TeamRecord>();
  readonly rooms = new Map<string, RoomRecord>();
  readonly invites = new Map<string, InviteRecord>();
  readonly inviteRequests = new Map<string, InviteJoinRequestRecord>();
  readonly inviteResponses = new Map<string, InviteResponseRecord>();
  readonly inviteAckReceipts = new Map<string, InviteAckReceipt>();
  readonly acceptedMessageReceipts = new Map<string, AcceptedMessageReceipt>();
  readonly devices = new Map<string, DeviceRecord>();
  readonly keyPackages = new Map<string, KeyPackageRecord>();
  readonly attachmentBlobs = new Map<string, AttachmentBlobRecord>();
  readonly teamMembers = new Map<string, Map<string, TeamMemberRecord>>();
  readonly rateLimitStore = new Map<string, RateLimitRecord>();
  readonly deviceSessions = new Map<string, DeviceSessionRecord>();

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
}

export function createRelayStore(): RelayStore {
  return new InMemoryRelayStore();
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

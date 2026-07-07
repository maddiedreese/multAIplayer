import type { WebSocket } from "ws";
import type {
  AttachmentBlobRecord,
  DeviceRecord,
  InviteRecord,
  RelayEnvelope,
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

export interface RelayStore {
  sessions: Map<WebSocket, ClientSession>;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  encryptedBacklog: Map<RoomKey, RelayEnvelope[]>;
  authSessions: Map<string, AuthSession>;
  teams: Map<string, TeamRecord>;
  rooms: Map<string, RoomRecord>;
  invites: Map<string, InviteRecord>;
  devices: Map<string, DeviceRecord>;
  attachmentBlobs: Map<string, AttachmentBlobRecord>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  rateLimitStore: Map<string, RateLimitRecord>;
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
  getEncryptedBacklog(roomKey: RoomKey): RelayEnvelope[] | undefined;
  setEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]): void;
  allEncryptedBacklogEntries(): Array<[RoomKey, RelayEnvelope[]]>;
}

export class InMemoryRelayStore implements RelayStore {
  readonly sessions = new Map<WebSocket, ClientSession>();
  readonly roomSockets = new Map<RoomKey, Set<WebSocket>>();
  readonly teamSockets = new Map<string, Set<WebSocket>>();
  readonly workspaceSockets = new Set<WebSocket>();
  readonly roomPresence = new Map<RoomKey, Map<string, PresenceRecord>>();
  readonly encryptedBacklog = new Map<RoomKey, RelayEnvelope[]>();
  readonly authSessions = new Map<string, AuthSession>();
  readonly teams = new Map<string, TeamRecord>();
  readonly rooms = new Map<string, RoomRecord>();
  readonly invites = new Map<string, InviteRecord>();
  readonly devices = new Map<string, DeviceRecord>();
  readonly attachmentBlobs = new Map<string, AttachmentBlobRecord>();
  readonly teamMembers = new Map<string, Map<string, TeamMemberRecord>>();
  readonly rateLimitStore = new Map<string, RateLimitRecord>();

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

  getEncryptedBacklog(roomKey: RoomKey): RelayEnvelope[] | undefined {
    return this.encryptedBacklog.get(roomKey);
  }

  setEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]): void {
    this.encryptedBacklog.set(roomKey, envelopes);
  }

  allEncryptedBacklogEntries(): Array<[RoomKey, RelayEnvelope[]]> {
    return Array.from(this.encryptedBacklog.entries());
  }
}

export function createRelayStore(): RelayStore {
  return new InMemoryRelayStore();
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

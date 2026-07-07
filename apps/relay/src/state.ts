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
  allRooms(): RoomRecord[];
  getRoom(roomId: string): RoomRecord | undefined;
  setRoom(room: RoomRecord): void;
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

  allRooms(): RoomRecord[] {
    return Array.from(this.rooms.values());
  }

  getRoom(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  setRoom(room: RoomRecord): void {
    this.rooms.set(room.id, room);
  }
}

export function createRelayStore(): RelayStore {
  return new InMemoryRelayStore();
}

import type { WebSocket } from "ws";
import type {
  DeviceRecord,
  RelayEnvelope,
  RelayServerMessage,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import type { RelayMetrics } from "../observability.js";
import type { ClientSession, PresenceRecord, RoomKey } from "../state.js";

interface CreateRelayFanoutOptions {
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  sessions: Map<WebSocket, ClientSession>;
  encryptedBacklog: Map<RoomKey, RelayEnvelope[]>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  devices: Map<string, DeviceRecord>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  metrics: RelayMetrics;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  deviceKey: (userId: string, deviceId: string) => string;
  pruneEncryptedBacklog: (envelopes: RelayEnvelope[]) => RelayEnvelope[];
  addTeamMember: (teamId: string, userId: string) => void;
  scheduleStoreSave: () => void;
  teamRecordForUser: (
    team: TeamRecord,
    teamMembers: Map<string, Map<string, TeamMemberRecord>>,
    userId: string | undefined
  ) => TeamRecord;
}

export function createRelayFanout({
  roomSockets,
  teamSockets,
  workspaceSockets,
  sessions,
  encryptedBacklog,
  roomPresence,
  devices,
  teamMembers,
  metrics,
  roomKey,
  deviceKey,
  pruneEncryptedBacklog,
  addTeamMember,
  scheduleStoreSave,
  teamRecordForUser
}: CreateRelayFanoutOptions) {
  function send(socket: WebSocket, message: RelayServerMessage) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function broadcast(key: RoomKey, message: RelayServerMessage) {
    const sockets = roomSockets.get(key);
    if (!sockets) return;
    for (const socket of sockets) {
      send(socket, message);
    }
  }

  function broadcastRoomUpdated(room: RoomRecord) {
    const sockets = new Set<WebSocket>();
    for (const socket of roomSockets.get(roomKey(room.teamId, room.id)) ?? []) sockets.add(socket);
    for (const socket of teamSockets.get(room.teamId) ?? []) sockets.add(socket);
    for (const socket of sockets) send(socket, { type: "room.updated", room });
  }

  function broadcastWorkspaceUpdated(team: TeamRecord) {
    for (const socket of workspaceSockets) {
      const session = sessions.get(socket);
      send(socket, { type: "team.updated", team: teamRecordForUser(team, teamMembers, session?.authSession?.user.id ?? session?.userId) });
    }
  }

  function publishEnvelope(envelope: RelayEnvelope) {
    const key = roomKey(envelope.teamId, envelope.roomId);
    const backlog = encryptedBacklog.get(key) ?? [];
    if (backlog.some((existing) => existing.id === envelope.id)) return;
    backlog.push(envelope);
    encryptedBacklog.set(key, pruneEncryptedBacklog(backlog));
    metrics.recordEnvelopePublished();
    scheduleStoreSave();
    broadcast(key, { type: "envelope", envelope });
  }

  function publishPresence(session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) {
    session.displayName = presence.displayName;
    session.avatarUrl = presence.avatarUrl;
    addTeamMember(teamId, presence.userId);
    const registeredDevice = devices.get(deviceKey(presence.userId, presence.deviceId));
    const verifiedPresence: PresenceRecord = {
      ...presence,
      publicKeyFingerprint: registeredDevice?.publicKeyFingerprint ?? presence.publicKeyFingerprint
    };
    const key = roomKey(teamId, roomId);
    const roster = roomPresence.get(key) ?? new Map<string, PresenceRecord>();
    roster.set(verifiedPresence.deviceId, verifiedPresence);
    roomPresence.set(key, roster);
    broadcast(key, { type: "presence", ...verifiedPresence, status: "online" });
  }

  return {
    send,
    broadcast,
    broadcastRoomUpdated,
    broadcastWorkspaceUpdated,
    publishEnvelope,
    publishPresence
  };
}

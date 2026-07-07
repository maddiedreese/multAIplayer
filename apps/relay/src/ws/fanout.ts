import type { WebSocket } from "ws";
import type {
  RelayEnvelope,
  RelayServerMessage,
  RoomRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import type { RelayMetrics } from "../observability.js";
import type { ClientSession, PresenceRecord, RelayStore, RoomKey } from "../state.js";

interface CreateRelayFanoutOptions {
  store: RelayStore;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  sessions: Map<WebSocket, ClientSession>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  metrics: RelayMetrics;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  pruneEncryptedBacklog: (envelopes: RelayEnvelope[]) => RelayEnvelope[];
  addTeamMember: (teamId: string, userId: string) => void;
  saveEncryptedBacklog: (roomKey: RoomKey, envelopes: RelayEnvelope[]) => void;
  teamRecordForUser: (
    team: TeamRecord,
    store: Pick<RelayStore, "getTeamMember">,
    userId: string | undefined
  ) => TeamRecord;
}

export function createRelayFanout({
  store,
  roomSockets,
  teamSockets,
  workspaceSockets,
  sessions,
  roomPresence,
  metrics,
  roomKey,
  pruneEncryptedBacklog,
  addTeamMember,
  saveEncryptedBacklog,
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
      send(socket, { type: "team.updated", team: teamRecordForUser(team, store, session?.authSession?.user.id ?? session?.userId) });
    }
  }

  function publishEnvelope(envelope: RelayEnvelope) {
    const key = roomKey(envelope.teamId, envelope.roomId);
    const backlog = store.getEncryptedBacklog(key) ?? [];
    if (backlog.some((existing) => existing.id === envelope.id)) return;
    backlog.push(envelope);
    const prunedBacklog = pruneEncryptedBacklog(backlog);
    store.setEncryptedBacklog(key, prunedBacklog);
    metrics.recordEnvelopePublished();
    saveEncryptedBacklog(key, prunedBacklog);
    broadcast(key, { type: "envelope", envelope });
  }

  function publishPresence(session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) {
    session.displayName = presence.displayName;
    session.avatarUrl = presence.avatarUrl;
    addTeamMember(teamId, presence.userId);
    const registeredDevice = store.getDevice(presence.userId, presence.deviceId);
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

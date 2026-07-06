import type { WebSocket } from "ws";
import type {
  RelayServerMessage,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import type { ClientSession, RoomKey } from "../state.js";

interface CreateRelayFanoutOptions {
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  sessions: Map<WebSocket, ClientSession>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  roomKey: (teamId: string, roomId: string) => RoomKey;
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
  teamMembers,
  roomKey,
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

  return {
    send,
    broadcast,
    broadcastRoomUpdated,
    broadcastWorkspaceUpdated
  };
}

import type { WebSocket } from "ws";
import type {
  InviteRecord,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamRole
} from "@multaiplayer/protocol";
import type { ClientSession, PresenceRecord, RoomKey } from "../state.js";

interface CreateRelayRoomSocketManagerOptions {
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  sessions: Map<WebSocket, ClientSession>;
  teams: Map<string, TeamRecord>;
  rooms: Map<string, RoomRecord>;
  invites: Map<string, InviteRecord>;
  mutationsRequireAuth: boolean;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  isTeamMember: (teamId: string, userId: string) => boolean;
  addTeamMember: (teamId: string, userId: string, role?: TeamRole) => void;
  scheduleStoreSave: () => void;
  send: (socket: WebSocket, message: { type: "error"; message: string }) => void;
  broadcast: (key: RoomKey, message: { type: "presence"; status: "online" | "offline" } & PresenceRecord) => void;
}

export function createRelayRoomSocketManager({
  roomSockets,
  teamSockets,
  workspaceSockets,
  roomPresence,
  sessions,
  teams,
  rooms,
  invites,
  mutationsRequireAuth,
  roomKey,
  canAccessRoom,
  isTeamMember,
  addTeamMember,
  scheduleStoreSave,
  send,
  broadcast
}: CreateRelayRoomSocketManagerOptions) {
  function joinRoom(session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) {
    leaveRoom(session);
    session.teamId = teamId;
    session.roomId = roomId;
    session.userId = userId;
    session.deviceId = deviceId;
    const key = roomKey(teamId, roomId);
    const sockets = roomSockets.get(key) ?? new Set<WebSocket>();
    sockets.add(session.socket);
    roomSockets.set(key, sockets);
  }

  function subscribeTeam(session: ClientSession, teamId: string) {
    session.subscribedTeamIds.add(teamId);
    const sockets = teamSockets.get(teamId) ?? new Set<WebSocket>();
    sockets.add(session.socket);
    teamSockets.set(teamId, sockets);
  }

  function subscribeWorkspace(session: ClientSession) {
    session.workspaceSubscribed = true;
    workspaceSockets.add(session.socket);
  }

  function isKnownRoom(teamId: string, roomId: string): boolean {
    return teams.has(teamId) && rooms.get(roomId)?.teamId === teamId;
  }

  function canJoinRoom(
    session: ClientSession,
    teamId: string,
    roomId: string,
    userId: string,
    inviteId?: string
  ): boolean {
    if (!mutationsRequireAuth) return true;
    if (!session.authSession || session.authSession.user.id !== userId) return false;
    if (canAccessRoom(teamId, roomId, userId)) return true;
    if (!inviteId || !isValidInviteForRoom(inviteId, teamId, roomId)) return false;
    addTeamMember(teamId, userId);
    return true;
  }

  function canSubscribeTeam(session: ClientSession, teamId: string, userId: string): boolean {
    if (!mutationsRequireAuth) return true;
    return Boolean(session.authSession && session.authSession.user.id === userId && isTeamMember(teamId, userId));
  }

  function canSubscribeWorkspace(session: ClientSession, userId: string): boolean {
    if (!mutationsRequireAuth) return true;
    return Boolean(session.authSession && session.authSession.user.id === userId);
  }

  function leaveRoom(session: ClientSession) {
    if (!session.teamId || !session.roomId) return;
    const key = roomKey(session.teamId, session.roomId);
    if (session.deviceId) {
      const roster = roomPresence.get(key);
      const presence = roster?.get(session.deviceId);
      if (presence) {
        roster?.delete(session.deviceId);
        if (roster?.size === 0) roomPresence.delete(key);
        broadcast(key, { type: "presence", ...presence, status: "offline" });
      }
    }
    const sockets = roomSockets.get(key);
    sockets?.delete(session.socket);
    if (sockets?.size === 0) roomSockets.delete(key);
  }

  function leaveTeams(session: ClientSession) {
    for (const teamId of session.subscribedTeamIds) {
      const sockets = teamSockets.get(teamId);
      sockets?.delete(session.socket);
      if (sockets?.size === 0) teamSockets.delete(teamId);
    }
    session.subscribedTeamIds.clear();
  }

  function leaveWorkspace(session: ClientSession) {
    if (!session.workspaceSubscribed) return;
    workspaceSockets.delete(session.socket);
    session.workspaceSubscribed = false;
  }

  function revokeTeamMemberSessions(teamId: string, userId: string) {
    for (const session of Array.from(sessions.values())) {
      if (session.authSession?.user.id !== userId && session.userId !== userId) continue;

      const joinedRemovedTeam = session.teamId === teamId;
      const subscribedRemovedTeam = session.subscribedTeamIds.has(teamId);
      const workspaceSubscribed = session.workspaceSubscribed;
      if (!joinedRemovedTeam && !subscribedRemovedTeam && !workspaceSubscribed) continue;

      send(session.socket, { type: "error", message: "Your team membership was removed. Rejoin with a fresh invite before continuing." });
      leaveRoom(session);
      leaveTeams(session);
      leaveWorkspace(session);
      session.socket.close(1008, "Team membership removed");
    }
  }

  function isValidInviteForRoom(inviteId: string, teamId: string, roomId: string): boolean {
    const invite = invites.get(inviteId);
    if (!invite || invite.teamId !== teamId || invite.roomId !== roomId) return false;
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      invites.delete(invite.id);
      scheduleStoreSave();
      return false;
    }
    return true;
  }

  return {
    joinRoom,
    subscribeTeam,
    subscribeWorkspace,
    isKnownRoom,
    canJoinRoom,
    canSubscribeTeam,
    canSubscribeWorkspace,
    leaveRoom,
    leaveTeams,
    leaveWorkspace,
    revokeTeamMemberSessions
  };
}

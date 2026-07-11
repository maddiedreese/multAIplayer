import type { WebSocket } from "ws";
import type { RelayEnvelope, RelayServerMessage, RoomRecord, TeamRecord } from "@multaiplayer/protocol";
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
  saveEncryptedEnvelope: (roomKey: RoomKey, envelope: RelayEnvelope, prunedEnvelopeIds: string[]) => Promise<void>;
  saveRoomKeyTransition: (roomKey: RoomKey, envelope: RelayEnvelope, prunedEnvelopeIds: string[]) => Promise<void>;
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
  saveEncryptedEnvelope,
  saveRoomKeyTransition,
  teamRecordForUser
}: CreateRelayFanoutOptions) {
  const acceptedEpochByRoom = new Map<RoomKey, number>();
  const rotatingRooms = new Set<RoomKey>();
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
      send(socket, {
        type: "team.updated",
        team: teamRecordForUser(team, store, session?.authSession?.user.id ?? session?.userId)
      });
    }
  }

  async function publishEnvelope(envelope: RelayEnvelope): Promise<void> {
    const key = roomKey(envelope.teamId, envelope.roomId);
    const previousBacklog = store.getEncryptedBacklog(key) ?? [];
    if (previousBacklog.some((existing) => existing.id === envelope.id)) return;
    if (rotatingRooms.has(key)) throw new Error("A room key transition is already being accepted. Retry this publish.");
    const room = store.getRoom(envelope.roomId);
    const acceptedEpoch = acceptedEpochByRoom.get(key) ?? room?.keyEpoch ?? deriveAcceptedEpoch(previousBacklog);
    acceptedEpochByRoom.set(key, acceptedEpoch);
    if (envelope.keyEpoch !== acceptedEpoch) {
      throw new Error(`Room envelope epoch ${envelope.keyEpoch} does not match accepted epoch ${acceptedEpoch}.`);
    }
    const advancesEpoch = envelope.kind === "room.key";
    if (advancesEpoch) {
      rotatingRooms.add(key);
      acceptedEpochByRoom.set(key, acceptedEpoch + 1);
      if (room) store.setRoom({ ...room, keyEpoch: acceptedEpoch + 1 });
    }
    const backlog = [...previousBacklog, envelope];
    const prunedBacklog = pruneEncryptedBacklog(backlog);
    const retainedIds = new Set(prunedBacklog.map((item) => item.id));
    const prunedEnvelopeIds = backlog
      .filter((item) => item.id !== envelope.id && !retainedIds.has(item.id))
      .map((item) => item.id);
    store.setEncryptedBacklog(key, prunedBacklog);
    try {
      if (advancesEpoch && room) {
        await saveRoomKeyTransition(key, envelope, prunedEnvelopeIds);
      } else {
        await saveEncryptedEnvelope(key, envelope, prunedEnvelopeIds);
      }
    } catch (error) {
      store.setEncryptedBacklog(key, previousBacklog);
      if (advancesEpoch) {
        acceptedEpochByRoom.set(key, acceptedEpoch);
        if (room) store.setRoom(room);
      }
      throw error;
    } finally {
      if (advancesEpoch) rotatingRooms.delete(key);
    }
    metrics.recordEnvelopePublished();
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

function deriveAcceptedEpoch(backlog: RelayEnvelope[]): number {
  return backlog.reduce(
    (epoch, envelope) => Math.max(epoch, envelope.kind === "room.key" ? envelope.keyEpoch + 1 : envelope.keyEpoch),
    1
  );
}

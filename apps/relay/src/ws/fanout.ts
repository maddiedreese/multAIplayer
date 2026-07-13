import type { WebSocket } from "ws";
import type { MlsRelayMessage, RelayServerMessage, RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { RelayMetrics } from "../observability.js";
import type { ClientSession, PresenceRecord, RelayStore, RoomKey } from "../state.js";
import { createHash, createPublicKey, verify } from "node:crypto";

export class RelayPublishError extends Error {
  constructor(
    readonly code: "stale_epoch" | "application_epoch_expired" | "not_active_host" | "invalid_message",
    message: string
  ) {
    super(message);
  }
}

interface Options {
  store: RelayStore;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  sessions: Map<WebSocket, ClientSession>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  metrics: RelayMetrics;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  pruneMlsBacklog: (messages: MlsRelayMessage[]) => MlsRelayMessage[];
  addTeamMember: (teamId: string, userId: string) => void;
  saveMlsMessage: (roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) => Promise<void>;
  saveMlsCommit: (roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) => Promise<void>;
  teamRecordForUser: (
    team: TeamRecord,
    store: Pick<RelayStore, "getTeamMember">,
    userId: string | undefined
  ) => TeamRecord;
}

export function createRelayFanout(options: Options) {
  const queues = new Map<RoomKey, Promise<void>>();
  const send = (socket: WebSocket, message: RelayServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const broadcast = (key: RoomKey, message: RelayServerMessage) => {
    for (const socket of options.roomSockets.get(key) ?? []) send(socket, message);
  };
  function broadcastRoomUpdated(room: RoomRecord) {
    const sockets = new Set<WebSocket>(options.roomSockets.get(options.roomKey(room.teamId, room.id)) ?? []);
    for (const socket of options.teamSockets.get(room.teamId) ?? []) sockets.add(socket);
    for (const socket of sockets) send(socket, { type: "room.updated", room });
  }
  function broadcastWorkspaceUpdated(team: TeamRecord) {
    for (const socket of options.workspaceSockets) {
      const session = options.sessions.get(socket);
      send(socket, {
        type: "team.updated",
        team: options.teamRecordForUser(team, options.store, session?.authSession?.user.id ?? session?.userId)
      });
    }
  }
  async function publishMlsMessage(message: MlsRelayMessage): Promise<void> {
    const key = options.roomKey(message.teamId, message.roomId);
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => pending);
    queues.set(key, queued);
    await previous.catch(() => undefined);
    try {
      await publishForRoom(key, message);
    } finally {
      release();
      if (queues.get(key) === queued) queues.delete(key);
    }
  }
  async function publishForRoom(key: RoomKey, message: MlsRelayMessage) {
    const digest = retryDigest(message);
    const receiptKey = `${key}\0${message.id}`;
    const acceptedReceipt = options.store.acceptedMessageReceipts.get(receiptKey);
    if (acceptedReceipt) {
      if (acceptedReceipt.digest === digest) return;
      throw new RelayPublishError("invalid_message", "Message id is already bound to different MLS bytes or metadata.");
    }
    const previous = options.store.getMlsBacklog(key) ?? [];
    const replay = previous.find((item) => item.id === message.id);
    if (replay) {
      if (sameRetry(replay, message)) return;
      throw new RelayPublishError("invalid_message", "Message id is already bound to different MLS bytes or metadata.");
    }
    const room = options.store.getRoom(message.roomId);
    if (!room) throw new Error("Room not found.");
    const acceptedEpoch = room.acceptedMlsEpoch ?? 0;
    if (message.messageType === "commit" && message.epochHint !== acceptedEpoch) {
      throw new RelayPublishError(
        "stale_epoch",
        `Commit epoch ${message.epochHint} is stale; accepted epoch is ${acceptedEpoch}.`
      );
    }
    if (message.messageType === "application" && message.epochHint > acceptedEpoch) {
      throw new RelayPublishError(
        "stale_epoch",
        `Application epoch ${message.epochHint} is ahead of accepted epoch ${acceptedEpoch}.`
      );
    }
    if (message.messageType === "application" && acceptedEpoch - message.epochHint > 2) {
      throw new RelayPublishError(
        "application_epoch_expired",
        `Application epoch ${message.epochHint} is outside the retained window at epoch ${acceptedEpoch}.`
      );
    }
    if (
      message.messageType === "commit" &&
      (room.hostStatus !== "active" ||
        room.hostUserId !== message.senderUserId ||
        room.activeHostDeviceId !== message.senderDeviceId)
    ) {
      throw new RelayPublishError("not_active_host", "Only the active host device may publish an MLS Commit.");
    }
    if (message.commitEffect === "host_handoff" && !validHostTransferAuthorization(options.store, room, message)) {
      throw new RelayPublishError("not_active_host", "Host transfer authorization is invalid or unauthenticated.");
    }
    const oldRoom = room;
    const previousReceipts = new Map(options.store.acceptedMessageReceipts);
    if (message.messageType === "commit")
      options.store.setRoom({
        ...room,
        acceptedMlsEpoch: acceptedEpoch + 1,
        ...(message.commitEffect === "host_handoff"
          ? {
              host: message.nextHostUserId!,
              hostUserId: message.nextHostUserId,
              activeHostDeviceId: message.nextHostDeviceId,
              hostStatus: "active" as const
            }
          : {})
      });
    const backlog = options.pruneMlsBacklog([...previous, message]);
    const retained = new Set(backlog.map((item) => item.id));
    const prunedIds = previous.filter((item) => !retained.has(item.id)).map((item) => item.id);
    options.store.setMlsBacklog(key, backlog);
    options.store.acceptedMessageReceipts.set(receiptKey, {
      roomKey: key,
      messageId: message.id,
      messageType: message.messageType,
      senderUserId: message.senderUserId,
      senderDeviceId: message.senderDeviceId,
      parentEpoch: message.epochHint,
      digest,
      acceptedAt: new Date().toISOString()
    });
    pruneAcceptedReceipts(options.store, key);
    try {
      if (message.messageType === "commit") await options.saveMlsCommit(key, message, prunedIds);
      else await options.saveMlsMessage(key, message, prunedIds);
    } catch (error) {
      options.store.setMlsBacklog(key, previous);
      options.store.setRoom(oldRoom);
      options.store.acceptedMessageReceipts.clear();
      for (const [id, receipt] of previousReceipts) options.store.acceptedMessageReceipts.set(id, receipt);
      if (error instanceof Error && error.name === "RelayStaleEpochError")
        throw new RelayPublishError("stale_epoch", "A competing Commit already advanced this room epoch.");
      throw error;
    }
    options.metrics.recordMlsMessagePublished();
    broadcast(key, { type: "mls.message", message });
    if (message.messageType === "commit") {
      const updatedRoom = options.store.getRoom(message.roomId);
      if (updatedRoom) broadcastRoomUpdated(updatedRoom);
    }
  }
  function publishPresence(session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) {
    session.displayName = presence.displayName;
    session.avatarUrl = presence.avatarUrl;
    options.addTeamMember(teamId, presence.userId);
    const registered = options.store.getDevice(presence.userId, presence.deviceId);
    const verified = {
      ...presence,
      publicKeyFingerprint: registered?.signatureKeyFingerprint ?? presence.publicKeyFingerprint
    };
    const key = options.roomKey(teamId, roomId);
    const roster = options.roomPresence.get(key) ?? new Map();
    roster.set(verified.deviceId, verified);
    options.roomPresence.set(key, roster);
    broadcast(key, { type: "presence", ...verified, status: "online" });
  }
  return { send, broadcast, broadcastRoomUpdated, broadcastWorkspaceUpdated, publishMlsMessage, publishPresence };
}

function retryDigest(message: MlsRelayMessage): string {
  if (message.messageType === "application") return createHash("sha256").update(JSON.stringify(message)).digest("hex");
  const { createdAt: _createdAt, ...commit } = message;
  return createHash("sha256").update(JSON.stringify(commit)).digest("hex");
}

function pruneAcceptedReceipts(store: RelayStore, roomKey: RoomKey) {
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const roomReceipts = Array.from(store.acceptedMessageReceipts.entries())
    .filter(([, receipt]) => receipt.roomKey === roomKey)
    .sort((left, right) => Date.parse(left[1].acceptedAt) - Date.parse(right[1].acceptedAt));
  for (const [id, receipt] of roomReceipts) {
    if (Date.parse(receipt.acceptedAt) < cutoff) store.acceptedMessageReceipts.delete(id);
  }
  const commitReceipts = roomReceipts.filter(
    ([id, receipt]) => receipt.messageType === "commit" && store.acceptedMessageReceipts.has(id)
  );
  for (const [id] of commitReceipts.slice(0, Math.max(0, commitReceipts.length - 4096)))
    store.acceptedMessageReceipts.delete(id);
  const applicationBySender = new Map<string, typeof roomReceipts>();
  for (const entry of roomReceipts) {
    const [id, receipt] = entry;
    if (receipt.messageType !== "application" || !store.acceptedMessageReceipts.has(id)) continue;
    const sender = receipt.senderUserId;
    const receipts = applicationBySender.get(sender) ?? [];
    receipts.push(entry);
    applicationBySender.set(sender, receipts);
  }
  for (const receipts of applicationBySender.values()) {
    for (const [id] of receipts.slice(0, Math.max(0, receipts.length - 4096))) store.acceptedMessageReceipts.delete(id);
  }
}

function sameRetry(previous: MlsRelayMessage, next: MlsRelayMessage): boolean {
  if (previous.messageType === "application" || next.messageType === "application")
    return JSON.stringify(previous) === JSON.stringify(next);
  const { createdAt: _previousCreated, ...previousCommit } = previous;
  const { createdAt: _nextCreated, ...nextCommit } = next;
  return JSON.stringify(previousCommit) === JSON.stringify(nextCommit);
}

function validHostTransferAuthorization(store: RelayStore, room: RoomRecord, message: MlsRelayMessage): boolean {
  const auth = message.hostTransferAuthorization;
  const device = store.getDevice(message.senderUserId, message.senderDeviceId);
  if (!auth || !device) return false;
  if (
    auth.roomId !== message.roomId ||
    auth.parentEpoch !== message.epochHint ||
    auth.outgoingHostUserId !== message.senderUserId ||
    auth.outgoingHostDeviceId !== message.senderDeviceId ||
    auth.nextHostUserId !== message.nextHostUserId ||
    auth.nextHostDeviceId !== message.nextHostDeviceId ||
    room.hostUserId !== auth.outgoingHostUserId ||
    room.activeHostDeviceId !== auth.outgoingHostDeviceId ||
    !store.getTeamMember(room.teamId, auth.nextHostUserId) ||
    !store.getDevice(auth.nextHostUserId, auth.nextHostDeviceId) ||
    auth.publicKeySpkiDer !== device.signaturePublicKey
  )
    return false;
  const hash = createHash("sha256").update(Buffer.from(message.mlsMessage, "base64")).digest("hex");
  if (hash !== auth.commitMessageId) return false;
  const { signatureDer, publicKeySpkiDer: _publicKey, ...signed } = auth;
  try {
    return verify(
      "sha256",
      Buffer.concat([
        Buffer.from("multaiplayer:host-transfer-authorization:v2\0", "ascii"),
        Buffer.from(JSON.stringify(signed), "utf8")
      ]),
      createPublicKey({ key: Buffer.from(device.signaturePublicKey, "base64"), format: "der", type: "spki" }),
      Buffer.from(signatureDer, "base64")
    );
  } catch {
    return false;
  }
}

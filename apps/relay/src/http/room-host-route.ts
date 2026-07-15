import { sendRelayError } from "./errors.js";
import type { RoomRecord } from "@multaiplayer/protocol";
import { hasDeviceSession } from "./device-auth.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

export function registerRoomHostRoute(options: RegisterRoomRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowMutation,
    canAccessRoom,
    scheduleStoreSave,
    broadcastRoomUpdated,
    normalizeMetadataText,
    maxHostNameChars,
    maxUserIdChars,
    maxDeviceIdChars
  } = options;

  app.patch("/rooms/:roomId/host", (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    const requestedHost = normalizeMetadataText(req.body?.host, maxHostNameChars);
    const requestedHostUserId = normalizeMetadataText(req.body?.hostUserId, maxUserIdChars);
    const requestedHostDeviceId = normalizeMetadataText(req.body?.hostDeviceId, maxDeviceIdChars);
    const requestedStatus = req.body?.hostStatus;
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const room = store.getRoom(roomId);
    if (!room) return void sendRelayError(res, 404, "room_not_found", "Room not found");
    if (hostStateUnavailable(room, store.getTeam(room.teamId)))
      return void sendRelayError(res, 409, "conflict", "Restore this room before changing host state.");
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this room before changing host state.");
    if (invalidRequestedHost(req.body, requestedHost, requestedHostUserId, requestedHostDeviceId))
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Host identity metadata is invalid or exceeds its protocol limit."
      );
    if (!isHostStatus(requestedStatus))
      return void sendRelayError(res, 400, "invalid_request", "Host status is invalid.");
    const isInitialBootstrap = isInitialHostBootstrap({
      body: req.body,
      room,
      session,
      requestedHost,
      requestedHostUserId,
      requestedHostDeviceId,
      deviceSession: req.get("x-device-session"),
      store
    });
    if (!isInitialBootstrap)
      return void sendRelayError(
        res,
        409,
        "conflict",
        "Protocol v2 host authority changes require a signed MLS handoff Commit."
      );
    const updated: RoomRecord = {
      ...room,
      activeHostDeviceId: requestedHostDeviceId!,
      hostStatus: "active",
      acceptedMlsEpoch: 0
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}

function hostStateUnavailable(
  room: RoomRecord,
  team: { archivedAt?: string | undefined; deletedAt?: string | undefined } | undefined
) {
  return Boolean(room.archivedAt || room.deletedAt || team?.archivedAt || team?.deletedAt);
}

function invalidRequestedHost(
  body: Record<string, unknown> | undefined,
  host: string | null,
  userId: string | null,
  deviceId: string | null
) {
  return !host || !userId || (body?.hostDeviceId !== undefined && !deviceId);
}

function isHostStatus(value: unknown): value is "active" | "handoff" | "offline" {
  return value === "active" || value === "handoff" || value === "offline";
}

function isInitialHostBootstrap(options: {
  body: unknown;
  room: RoomRecord;
  session: ReturnType<RegisterRoomRoutesOptions["getAuthSession"]>;
  requestedHost: string | null;
  requestedHostUserId: string | null;
  requestedHostDeviceId: string | null;
  deviceSession: string | undefined;
  store: RegisterRoomRoutesOptions["store"];
}): boolean {
  const { room, session } = options;
  if (!session || !options.requestedHostDeviceId || !hasExactHostBootstrapBody(options.body)) return false;
  if (room.hostStatus !== "offline" || room.acceptedMlsEpoch !== undefined) return false;
  if (room.hostUserId !== session.user.id || options.requestedHostUserId !== session.user.id) return false;
  if (options.requestedHost !== room.host) return false;
  return hasDeviceSession(options.store, options.deviceSession, session.user.id, options.requestedHostDeviceId);
}

function hasExactHostBootstrapBody(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const expected = ["host", "hostUserId", "hostDeviceId", "hostStatus"];
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

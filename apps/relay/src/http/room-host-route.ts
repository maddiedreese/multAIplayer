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
    if (
      room.archivedAt ||
      room.deletedAt ||
      store.getTeam(room.teamId)?.archivedAt ||
      store.getTeam(room.teamId)?.deletedAt
    )
      return void sendRelayError(res, 409, "conflict", "Restore this room before changing host state.");
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this room before changing host state.");
    if (!requestedHost || !requestedHostUserId || (req.body?.hostDeviceId !== undefined && !requestedHostDeviceId))
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Host identity metadata is invalid or exceeds its protocol limit."
      );
    if (requestedStatus !== "active" && requestedStatus !== "handoff" && requestedStatus !== "offline")
      return void sendRelayError(res, 400, "invalid_request", "Host status is invalid.");
    const isInitialBootstrap =
      session &&
      hasExactHostBootstrapBody(req.body) &&
      room.hostStatus === "offline" &&
      room.acceptedMlsEpoch === undefined &&
      room.hostUserId === session.user.id &&
      requestedHostUserId === session.user.id &&
      requestedHost === room.host &&
      requestedHostDeviceId &&
      hasDeviceSession(store, req.get("x-device-session"), session.user.id, requestedHostDeviceId);
    if (!isInitialBootstrap)
      return void sendRelayError(
        res,
        409,
        "conflict",
        "Protocol v2 host authority changes require a signed MLS handoff Commit."
      );
    const updated: RoomRecord = {
      ...room,
      activeHostDeviceId: requestedHostDeviceId,
      hostStatus: "active",
      acceptedMlsEpoch: 0
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}

function hasExactHostBootstrapBody(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const expected = ["host", "hostUserId", "hostDeviceId", "hostStatus"];
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

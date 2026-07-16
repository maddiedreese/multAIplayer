import { sendRelayError } from "./errors.js";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";
import { revokeRoomInvites } from "../relay-domain.js";

export function registerRoomLifecycleRoute(options: RegisterRoomRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowMutation,
    canAccessRoom,
    requesterFromRequest,
    isRoomHost,
    scheduleStoreSave,
    broadcastRoomUpdated
  } = options;

  app.patch("/rooms/:roomId/lifecycle", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const roomId = String(req.params.roomId ?? "");
    const action = String(req.body?.action ?? "");
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room || room.deletedAt || store.getTeam(room.teamId)?.deletedAt)
      return void sendRelayError(res, 404, "room_not_found", "Room not found");
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this room before changing its archive state.");
    if (!isRoomLifecycleAction(action))
      return void sendRelayError(res, 400, "invalid_request", "action must be archive, restore, or delete");
    const requesterRole = session ? store.getTeamMember(room.teamId, session.user.id)?.role : "owner";
    if (!canManageRoomLifecycle(requesterRole, room, requester, isRoomHost))
      return void sendRelayError(
        res,
        403,
        "forbidden",
        "Only the active host or a team owner/admin can archive, restore, or delete a room."
      );
    const team = store.getTeam(room.teamId);
    if (action === "restore" && team?.archivedAt)
      return void sendRelayError(res, 409, "conflict", "Restore the team before restoring this room.");

    const updated = roomAfterLifecycleAction(room, action, new Date().toISOString());
    store.setRoom(updated);
    revokeDeletedRoomInvites(store, updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}

function revokeDeletedRoomInvites(store: RegisterRoomRoutesOptions["store"], room: RoomRecord): void {
  if (room.deletedAt) revokeRoomInvites(store, room.teamId, room.id);
}

function canManageRoomLifecycle(
  role: string | undefined,
  room: RoomRecord,
  requester: Parameters<RegisterRoomRoutesOptions["isRoomHost"]>[1],
  isRoomHost: RegisterRoomRoutesOptions["isRoomHost"]
): boolean {
  if (role === "owner" || role === "admin") return true;
  return room.hostStatus === "active" && isRoomHost(room, requester);
}

function roomAfterLifecycleAction(room: RoomRecord, action: "archive" | "restore" | "delete", now: string): RoomRecord {
  if (action === "restore") return { ...room, archivedAt: undefined };
  if (action === "archive") return { ...room, archivedAt: room.archivedAt ?? now };
  return { ...room, archivedAt: undefined, deletedAt: now };
}

function isRoomLifecycleAction(value: string): value is "archive" | "restore" | "delete" {
  return value === "archive" || value === "restore" || value === "delete";
}

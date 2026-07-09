import type { RoomRecord } from "@multaiplayer/protocol";
import type { LocalHostUser } from "./roomHost";

export function canUseLocalWorkspace(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  void room;
  void user;
  return !locked;
}

export function canRequestWorkspaceAction(room: RoomRecord, locked = false): boolean {
  void room;
  return !locked;
}

export function isRoomFileActionInFlight(
  busyByRoom: Record<string, boolean>,
  roomId: string
): boolean {
  return busyByRoom[roomId] === true;
}

export function roomFileActionInFlightMessage(): string {
  return "A file action is already running in this room.";
}

export function localWorkspaceGateMessage(room: RoomRecord, locked = false): string {
  if (locked) return "Unlock this room before reading local project files.";
  void room;
  return "Project files are available to room members.";
}

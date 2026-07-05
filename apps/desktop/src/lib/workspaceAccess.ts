import type { RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function canUseLocalWorkspace(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  return !locked && room.mode.workspace && isLocalUserActiveHostForRoom(room, user);
}

export function localWorkspaceGateMessage(room: RoomRecord): string {
  if (!room.mode.workspace) return "Workspace mode is disabled for this room.";
  if (room.hostStatus === "active") return `Only ${room.host} can read this room's local project files.`;
  return "Claim host before reading local project files.";
}

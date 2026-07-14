import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { SidebarMessageHitDisplay, SidebarRoomDisplay, SidebarTeamDisplay } from "../components/DesktopSidebar";
import type { BrowserAccessRequest, ChatMessage, TerminalCommandRequest } from "../types";
import { formatTeamMeta } from "./appFormatters";
import { inspectorAttentionCounts } from "./inspectorAttention";

export interface SidebarMessageHit {
  roomId: string;
  message: ChatMessage;
}

export function buildSidebarTeamRows(teams: TeamRecord[], selectedTeamId: string): SidebarTeamDisplay[] {
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    meta: team.archivedAt ? `${formatTeamMeta(team)} · Archived` : formatTeamMeta(team),
    active: team.id === selectedTeamId,
    archived: Boolean(team.archivedAt)
  }));
}

export function buildSidebarRoomRows({
  rooms,
  allRooms,
  teams,
  searchActive,
  selectedRoomId,
  approvalVisibleByRoom,
  terminalRequestsByRoom,
  browserRequestsByRoom
}: {
  rooms: RoomRecord[];
  allRooms: RoomRecord[];
  teams: TeamRecord[];
  searchActive: boolean;
  selectedRoomId: string;
  approvalVisibleByRoom: Record<string, boolean>;
  terminalRequestsByRoom: Record<string, TerminalCommandRequest[]>;
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
}): SidebarRoomDisplay[] {
  return rooms.map((room) => {
    const roomAttention = inspectorAttentionCounts({
      approvalVisible: approvalVisibleByRoom[room.id] ?? false,
      terminalRequests: terminalRequestsByRoom[room.id] ?? [],
      browserRequests: browserRequestsByRoom[room.id] ?? []
    });
    const roomAttentionTotal = roomAttention.work + roomAttention.browser;
    const team = teams.find((item) => item.id === room.teamId);
    const roomRecord = allRooms.find((item) => item.id === room.id) ?? room;

    return {
      id: room.id,
      teamId: room.teamId,
      name: room.name,
      detail: searchActive ? (team?.name ?? "Team") : (room.projectPath.split("/").at(-1) ?? room.projectPath),
      active: room.id === selectedRoomId,
      attention: roomAttentionTotal,
      unread: roomRecord.unread,
      archived: Boolean(room.archivedAt || team?.archivedAt)
    };
  });
}

export function buildSidebarMessageHitRows(hits: SidebarMessageHit[], rooms: RoomRecord[]): SidebarMessageHitDisplay[] {
  return hits.map((hit) => {
    const room = rooms.find((item) => item.id === hit.roomId);

    return {
      key: `${hit.roomId}-${hit.message.id}`,
      roomId: hit.roomId,
      teamId: room?.teamId,
      author: hit.message.author,
      preview: `${room?.name ?? "Room"} · ${hit.message.body}`
    };
  });
}

import { useMemo } from "react";
import type { ApprovalPolicy, ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { BrowserAccessRequest, ChatMessage, TerminalCommandRequest } from "../types";
import { buildSidebarMessageHitRows, buildSidebarRoomRows, buildSidebarTeamRows } from "../lib/sidebarDisplayRows";
import { findSidebarMessageHits, mergeSearchableMessages, searchMatches } from "../lib/sidebarSearch";

interface UseSidebarNavigationOptions {
  sidebarQuery: string;
  rooms: ClientRoomRecord[];
  teams: TeamRecord[];
  selectedTeam: string;
  selectedRoomId: string;
  messagesByRoom: Record<string, ChatMessage[]>;
  historySearchMessagesByRoom: Record<string, ChatMessage[]>;
  approvalVisibleByRoom: Record<string, boolean>;
  terminalRequestsByRoom: Record<string, TerminalCommandRequest[]>;
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
  approvalPolicyLabels: Record<ApprovalPolicy, string>;
}

export function useSidebarNavigation({
  sidebarQuery,
  rooms,
  teams,
  selectedTeam,
  selectedRoomId,
  messagesByRoom,
  historySearchMessagesByRoom,
  approvalVisibleByRoom,
  terminalRequestsByRoom,
  browserRequestsByRoom,
  approvalPolicyLabels
}: UseSidebarNavigationOptions) {
  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const searchActive = normalizedSidebarQuery.length > 0;
  const teamRooms = useMemo(() => rooms.filter((room) => room.teamId === selectedTeam), [rooms, selectedTeam]);
  const visibleRooms = useMemo(
    () =>
      searchActive
        ? rooms.filter((room) => {
            const team = teams.find((item) => item.id === room.teamId);
            return searchMatches(
              [
                room.name,
                room.projectPath,
                room.host,
                room.hostStatus,
                room.codexModel,
                approvalPolicyLabels[room.approvalPolicy],
                team?.name ?? ""
              ],
              normalizedSidebarQuery
            );
          })
        : teamRooms,
    [approvalPolicyLabels, normalizedSidebarQuery, rooms, searchActive, teamRooms, teams]
  );
  const visibleTeams = useMemo(() => {
    if (!searchActive) return teams;
    const visibleRoomTeamIds = new Set(visibleRooms.map((room) => room.teamId));
    return teams.filter(
      (team) => visibleRoomTeamIds.has(team.id) || searchMatches([team.name], normalizedSidebarQuery)
    );
  }, [normalizedSidebarQuery, searchActive, teams, visibleRooms]);
  const searchableMessagesByRoom = useMemo(() => {
    return mergeSearchableMessages(messagesByRoom, historySearchMessagesByRoom);
  }, [historySearchMessagesByRoom, messagesByRoom]);
  const visibleMessageHits = useMemo(() => {
    return searchActive ? findSidebarMessageHits(searchableMessagesByRoom, normalizedSidebarQuery) : [];
  }, [normalizedSidebarQuery, searchableMessagesByRoom, searchActive]);

  return {
    searchActive,
    sidebarTeamRows: buildSidebarTeamRows(visibleTeams, selectedTeam),
    sidebarRoomRows: buildSidebarRoomRows({
      rooms: visibleRooms,
      allRooms: rooms,
      teams,
      searchActive,
      selectedRoomId,
      approvalVisibleByRoom,
      terminalRequestsByRoom,
      browserRequestsByRoom
    }),
    sidebarMessageHitRows: buildSidebarMessageHitRows(visibleMessageHits, rooms)
  };
}

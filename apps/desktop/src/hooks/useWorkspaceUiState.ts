import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { ChatMessage, SidebarPanel } from "../types";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import {
  markRoomRead as markRoomReadRecord,
  markRoomUnreadForIncomingChat,
  replaceRoomPreservingUnread,
  upsertRoomPreservingUnread
} from "../lib/roomUnread";
import { useAppStore } from "../store/appStore";
import {
  projectTeamMembersBusyByTeam,
  projectTeamMembersByTeam,
  projectTeamMembersMessageByTeam
} from "../store/slices/workspaceDataSlice";

export function useWorkspaceUiState({
  initialTeams,
  initialRooms,
  initialTeamMembersByTeam,
  initialProjectPath,
  initialRoomId,
  initialMessagesByRoom
}: {
  initialTeams: TeamRecord[];
  initialRooms: RoomRecord[];
  initialTeamMembersByTeam: Record<string, TeamMemberRecord[]>;
  initialProjectPath: string;
  initialRoomId: string;
  initialMessagesByRoom: Record<string, ChatMessage[]>;
}) {
  const [teams, setTeams] = useState<TeamRecord[]>(initialTeams);
  const [rooms, setRooms] = useState<RoomRecord[]>(initialRooms);
  const teamRosterByTeam = useAppStore((state) => state.teamRosterByTeam);
  const {
    teamMembersByTeam,
    teamMembersMessageByTeam,
    teamMembersBusyByTeam
  } = useMemo(() => ({
    teamMembersByTeam: projectTeamMembersByTeam(teamRosterByTeam),
    teamMembersMessageByTeam: projectTeamMembersMessageByTeam(teamRosterByTeam),
    teamMembersBusyByTeam: projectTeamMembersBusyByTeam(teamRosterByTeam)
  }), [teamRosterByTeam]);
  const seedWorkspaceInitialDataIfEmpty = useAppStore((state) => state.seedWorkspaceInitialDataIfEmpty);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomProjectPath, setNewRoomProjectPath] = useState(initialProjectPath);
  const [selectedTeam, setSelectedTeam] = useState(initialTeams[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const messagesByRoom = useAppStore((state) => state.messagesByRoom);
  const replaceTeams = useCallback((nextTeams: TeamRecord[]) => {
    setTeams(nextTeams);
  }, []);
  const replaceRooms = useCallback((nextRooms: RoomRecord[]) => {
    setRooms(nextRooms);
  }, []);
  const selectExistingTeamOrFirst = useCallback((nextTeams: TeamRecord[]) => {
    setSelectedTeam((current) =>
      nextTeams.some((team) => team.id === current) ? current : nextTeams[0]?.id ?? ""
    );
  }, []);
  const selectExistingRoomOrFirst = useCallback((nextRooms: RoomRecord[]) => {
    setSelectedRoomId((current) =>
      nextRooms.some((room) => room.id === current) ? current : nextRooms[0]?.id ?? ""
    );
  }, []);
  const setWorkspaceStatusError = useCallback((message: string | null) => {
    setWorkspaceError(message);
  }, []);
  const updateTeamRoleForTeam = useCallback((teamId: string, role: TeamRecord["role"] | undefined) => {
    setTeams((current) => current.map((team) =>
      team.id === teamId ? { ...team, role: role ?? team.role } : team
    ));
  }, []);
  const updateTeamMemberCountForTeam = useCallback((teamId: string, members: number) => {
    setTeams((current) => current.map((team) =>
      team.id === teamId ? { ...team, members } : team
    ));
  }, []);
  const upsertTeamRecord = useCallback((team: TeamRecord) => {
    setTeams((current) => {
      if (current.some((item) => item.id === team.id)) {
        return current.map((item) => (item.id === team.id ? team : item));
      }
      return [...current, team];
    });
  }, []);
  const upsertRoomRecord = useCallback((room: RoomRecord) => {
    setRooms((current) => upsertRoomPreservingUnread(current, ensureRoomDefaults(room)));
  }, []);
  const replaceRoomRecord = useCallback((room: RoomRecord) => {
    setRooms((current) => replaceRoomPreservingUnread(current, ensureRoomDefaults(room)));
  }, []);
  const markRoomReadById = useCallback((roomId: string) => {
    setRooms((current) => markRoomReadRecord(current, roomId));
  }, []);
  const markIncomingChatUnread = useCallback((
    roomId: string,
    activeRoomId: string,
    senderDeviceId: string,
    localDeviceId: string
  ) => {
    setRooms((current) => markRoomUnreadForIncomingChat(current, roomId, activeRoomId, senderDeviceId, localDeviceId));
  }, []);
  const selectWorkspaceRoom = useCallback((teamId: string, roomId: string) => {
    setSelectedTeam(teamId);
    setSelectedRoomId(roomId);
  }, []);
  const selectTeamRoom = useCallback((teamId: string, fallbackRoomId: string) => {
    setSelectedTeam(teamId);
    setSelectedRoomId(rooms.find((room) => room.teamId === teamId)?.id ?? fallbackRoomId);
  }, [rooms]);

  useLayoutEffect(() => {
    seedWorkspaceInitialDataIfEmpty({
      teamMembersByTeam: initialTeamMembersByTeam,
      messagesByRoom: initialMessagesByRoom
    });
  }, [initialMessagesByRoom, initialTeamMembersByTeam, seedWorkspaceInitialDataIfEmpty]);

  return {
    teams,
    replaceTeams,
    updateTeamRoleForTeam,
    updateTeamMemberCountForTeam,
    upsertTeamRecord,
    rooms,
    replaceRooms,
    upsertRoomRecord,
    replaceRoomRecord,
    markRoomReadById,
    markIncomingChatUnread,
    teamMembersByTeam,
    teamMembersMessageByTeam,
    teamMembersBusyByTeam,
    workspaceError,
    setWorkspaceStatusError,
    activeSidebarPanel,
    setActiveSidebarPanel,
    newTeamName,
    setNewTeamName,
    newRoomName,
    setNewRoomName,
    newRoomProjectPath,
    setNewRoomProjectPath,
    selectedTeam,
    setSelectedTeam,
    selectExistingTeamOrFirst,
    selectedRoomId,
    setSelectedRoomId,
    selectExistingRoomOrFirst,
    selectWorkspaceRoom,
    selectTeamRoom,
    sidebarQuery,
    setSidebarQuery,
    messagesByRoom
  };
}

import { useLayoutEffect, useState } from "react";
import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { ChatMessage, SidebarPanel } from "../types";
import { useAppStore } from "../store/appStore";

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
  const teamMembersByTeam = useAppStore((state) => state.teamMembersByTeam);
  const teamMembersMessageByTeam = useAppStore((state) => state.teamMembersMessageByTeam);
  const teamMembersBusyByTeam = useAppStore((state) => state.teamMembersBusyByTeam);
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

  useLayoutEffect(() => {
    seedWorkspaceInitialDataIfEmpty({
      teamMembersByTeam: initialTeamMembersByTeam,
      messagesByRoom: initialMessagesByRoom
    });
  }, [initialMessagesByRoom, initialTeamMembersByTeam, seedWorkspaceInitialDataIfEmpty]);

  return {
    teams,
    setTeams,
    rooms,
    setRooms,
    teamMembersByTeam,
    teamMembersMessageByTeam,
    teamMembersBusyByTeam,
    workspaceError,
    setWorkspaceError,
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
    selectedRoomId,
    setSelectedRoomId,
    sidebarQuery,
    setSidebarQuery,
    messagesByRoom
  };
}

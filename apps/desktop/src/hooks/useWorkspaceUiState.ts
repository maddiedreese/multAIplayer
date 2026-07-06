import { useState } from "react";
import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { ChatMessage, SidebarPanel } from "../types";

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
  const [teamMembersByTeam, setTeamMembersByTeam] = useState<Record<string, TeamMemberRecord[]>>(initialTeamMembersByTeam);
  const [teamMembersMessageByTeam, setTeamMembersMessageByTeam] = useState<Record<string, string | null>>({});
  const [teamMembersBusyByTeam, setTeamMembersBusyByTeam] = useState<Record<string, boolean>>({});
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomProjectPath, setNewRoomProjectPath] = useState(initialProjectPath);
  const [selectedTeam, setSelectedTeam] = useState(initialTeams[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>(initialMessagesByRoom);

  return {
    teams,
    setTeams,
    rooms,
    setRooms,
    teamMembersByTeam,
    setTeamMembersByTeam,
    teamMembersMessageByTeam,
    setTeamMembersMessageByTeam,
    teamMembersBusyByTeam,
    setTeamMembersBusyByTeam,
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
    messagesByRoom,
    setMessagesByRoom
  };
}

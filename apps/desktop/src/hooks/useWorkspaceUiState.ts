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
  const setTeamMembersByTeam = useAppStore((state) => state.setTeamMembersByTeam);
  const teamMembersMessageByTeam = useAppStore((state) => state.teamMembersMessageByTeam);
  const setTeamMembersMessageByTeam = useAppStore((state) => state.setTeamMembersMessageByTeam);
  const teamMembersBusyByTeam = useAppStore((state) => state.teamMembersBusyByTeam);
  const setTeamMembersBusyByTeam = useAppStore((state) => state.setTeamMembersBusyByTeam);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomProjectPath, setNewRoomProjectPath] = useState(initialProjectPath);
  const [selectedTeam, setSelectedTeam] = useState(initialTeams[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const messagesByRoom = useAppStore((state) => state.messagesByRoom);
  const setMessagesByRoom = useAppStore((state) => state.setMessagesByRoom);

  useLayoutEffect(() => {
    if (Object.keys(initialTeamMembersByTeam).length > 0) {
      setTeamMembersByTeam((current) => (
        Object.keys(current).length === 0 ? initialTeamMembersByTeam : current
      ));
    }
    if (Object.keys(initialMessagesByRoom).length > 0) {
      setMessagesByRoom((current) => (
        Object.keys(current).length === 0 ? initialMessagesByRoom : current
      ));
    }
  }, [initialMessagesByRoom, initialTeamMembersByTeam, setMessagesByRoom, setTeamMembersByTeam]);

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

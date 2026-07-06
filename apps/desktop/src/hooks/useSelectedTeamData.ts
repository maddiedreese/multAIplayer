import type { TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "../lib/authClient";
import { buildTeamMemberRows } from "../lib/rosterDisplayRows";

interface UseSelectedTeamDataOptions {
  teams: TeamRecord[];
  selectedTeam: string;
  teamMembersByTeam: Record<string, TeamMemberRecord[]>;
  teamMembersMessageByTeam: Record<string, string | null>;
  teamMembersBusyByTeam: Record<string, boolean>;
  currentUser: SignedInUser | null;
  localUserId: string;
}

export function useSelectedTeamData({
  teams,
  selectedTeam,
  teamMembersByTeam,
  teamMembersMessageByTeam,
  teamMembersBusyByTeam,
  currentUser,
  localUserId
}: UseSelectedTeamDataOptions) {
  const selectedTeamRecord = teams.find((team) => team.id === selectedTeam) ?? null;
  const selectedTeamName = selectedTeamRecord?.name ?? (teams.length ? "No team selected" : "No teams yet");
  const selectedTeamMembers = teamMembersByTeam[selectedTeam] ?? [];
  const selectedTeamMembersMessage = teamMembersMessageByTeam[selectedTeam] ?? null;
  const selectedTeamMembersBusy = teamMembersBusyByTeam[selectedTeam] ?? false;
  const selectedTeamMemberRows = buildTeamMemberRows({
    members: selectedTeamMembers,
    team: selectedTeamRecord,
    currentUser,
    localUserId
  });

  return {
    selectedTeamRecord,
    selectedTeamName,
    selectedTeamMembers,
    selectedTeamMembersMessage,
    selectedTeamMembersBusy,
    selectedTeamMemberRows
  };
}

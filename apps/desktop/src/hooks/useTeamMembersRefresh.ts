import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type { TeamMemberRecord } from "@multaiplayer/protocol";
import { loadTeamMembers } from "../lib/workspaceClient";

interface UseTeamMembersRefreshOptions {
  selectedTeam: string;
  relayHttpUrl: string;
  setTeamMembersByTeam: Dispatch<SetStateAction<Record<string, TeamMemberRecord[]>>>;
  setTeamMembersMessageByTeam: Dispatch<SetStateAction<Record<string, string | null>>>;
}

export function useTeamMembersRefresh({
  selectedTeam,
  relayHttpUrl,
  setTeamMembersByTeam,
  setTeamMembersMessageByTeam
}: UseTeamMembersRefreshOptions) {
  const refreshTeamMembers = useCallback(async (teamId: string, showErrors = true): Promise<void> => {
    if (!teamId) return;
    try {
      const members = await loadTeamMembers(teamId);
      setTeamMembersByTeam((current) => ({ ...current, [teamId]: members }));
      setTeamMembersMessageByTeam((current) => ({ ...current, [teamId]: null }));
    } catch (error) {
      if (showErrors) {
        setTeamMembersMessageByTeam((current) => ({ ...current, [teamId]: String(error) }));
      }
    }
  }, [relayHttpUrl, setTeamMembersByTeam, setTeamMembersMessageByTeam]);

  useEffect(() => {
    if (!selectedTeam) return;
    void refreshTeamMembers(selectedTeam);
  }, [refreshTeamMembers, selectedTeam]);

  return { refreshTeamMembers };
}

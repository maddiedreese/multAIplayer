import { useCallback, useEffect } from "react";
import { loadTeamMembers } from "../lib/workspaceClient";
import { useAppStore } from "../store/appStore";

interface UseTeamMembersRefreshOptions {
  selectedTeam: string;
}

export function useTeamMembersRefresh({ selectedTeam }: UseTeamMembersRefreshOptions) {
  const setTeamMembersForTeam = useAppStore((state) => state.setTeamMembersForTeam);
  const setTeamMembersMessageForTeam = useAppStore((state) => state.setTeamMembersMessageForTeam);

  const refreshTeamMembers = useCallback(
    async (teamId: string, showErrors = true): Promise<void> => {
      if (!teamId) return;
      try {
        const members = await loadTeamMembers(teamId);
        setTeamMembersForTeam(teamId, members);
        setTeamMembersMessageForTeam(teamId, null);
      } catch (error) {
        if (showErrors) {
          setTeamMembersMessageForTeam(teamId, String(error));
        }
      }
    },
    [setTeamMembersForTeam, setTeamMembersMessageForTeam]
  );

  useEffect(() => {
    if (!selectedTeam) return;
    void refreshTeamMembers(selectedTeam);
  }, [refreshTeamMembers, selectedTeam]);

  return { refreshTeamMembers };
}

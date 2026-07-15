import { useCallback, useEffect } from "react";
import { loadTeamMembers } from "../application/workspace/workspaceClient";
import { RelayHttpError } from "../lib/core/httpResponse";
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
          setTeamMembersMessageForTeam(
            teamId,
            error instanceof RelayHttpError && error.status === 403
              ? "Team members become available after this device has team access."
              : "Team members could not be loaded. Check the relay connection and try again."
          );
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

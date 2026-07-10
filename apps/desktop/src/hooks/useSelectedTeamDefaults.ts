import { useEffect } from "react";
import { useAppStore } from "../store/appStore";

interface UseSelectedTeamDefaultsOptions {
  selectedTeam: string;
}

export function useSelectedTeamDefaults({
  selectedTeam
}: UseSelectedTeamDefaultsOptions) {
  const loadDefaultsForTeam = useAppStore((state) => state.loadDefaultsForTeam);
  useEffect(() => {
    if (!selectedTeam) return;
    loadDefaultsForTeam(selectedTeam);
  }, [loadDefaultsForTeam, selectedTeam]);
}

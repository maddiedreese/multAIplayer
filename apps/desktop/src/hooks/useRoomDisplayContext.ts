import { useFileTerminalDisplay } from "./useFileTerminalDisplay";
import { useSidebarNavigation } from "./useSidebarNavigation";
import { useTeamMembersRefresh } from "./useTeamMembersRefresh";

export function useRoomDisplayContext({
  fileTerminal,
  sidebar,
  teamMembers
}: {
  fileTerminal: Parameters<typeof useFileTerminalDisplay>[0];
  sidebar: Parameters<typeof useSidebarNavigation>[0];
  teamMembers: Parameters<typeof useTeamMembersRefresh>[0];
}) {
  return {
    ...useFileTerminalDisplay(fileTerminal),
    ...useSidebarNavigation(sidebar),
    ...useTeamMembersRefresh(teamMembers)
  };
}

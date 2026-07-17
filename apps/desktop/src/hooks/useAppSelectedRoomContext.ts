import { useMarkdownSelection } from "./useMarkdownSelection";
import { useSelectedRoomValues } from "./useSelectedRoomValues";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useAppStore } from "../store/appStore";
import {
  projectTeamMembersBusyByTeam,
  projectTeamMembersByTeam,
  projectTeamMembersMessageByTeam
} from "../store/slices/workspaceDataSlice";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasAcknowledgedRoomVisibilityWarning } from "../lib/history/roomVisibilityWarning";
import { buildTeamMemberRows } from "../presentation/roster/rosterDisplayRows";

type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;

export function useAppSelectedRoomContext({
  githubAuth,
  localIdentity,
  defaultBrowserUrl,
  defaultBrowserReason
}: {
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}) {
  const selectedState = useAppStore(
    useShallow((state) => {
      const roomId = state.rooms.find((room) => room.id === state.selectedRoomId)?.id ?? null;
      return {
        rooms: state.rooms,
        teams: state.teams,
        selectedRoomId: state.selectedRoomId,
        selectedTeam: state.selectedTeam,
        roomId,
        teamRoster: state.teamRosterByTeam[state.selectedTeam],
        messages: roomId ? state.messagesByRoom[roomId] : undefined,
        roomChat: roomId ? state.roomChatByRoom[roomId] : undefined,
        roomSettings: roomId ? state.roomSettingsByRoom[roomId] : undefined,
        codexRuntime: roomId ? state.codexRuntimeByRoom[roomId] : undefined,
        browser: roomId ? state.browserByRoom[roomId] : undefined,
        gitRuntime: roomId ? state.gitWorkflowRuntimeByRoom[roomId] : undefined,
        terminalRuntime: roomId ? state.terminalRuntimeByRoom[roomId] : undefined,
        filePanel: roomId ? state.filePanelByRoom[roomId] : undefined,
        invite: roomId ? state.inviteByRoom[roomId] : undefined,
        historyPresence: roomId ? state.historyPresenceByRoom[roomId] : undefined,
        teamHistory: state.teamHistoryByTeam[state.selectedTeam],
        terminals: state.terminals
      };
    })
  );
  const {
    rooms,
    teams,
    selectedRoomId,
    selectedTeam,
    teamRoster,
    messages,
    roomChat,
    roomSettings,
    codexRuntime,
    browser,
    gitRuntime,
    terminalRuntime,
    filePanel,
    invite,
    historyPresence,
    teamHistory,
    terminals
  } = selectedState;
  const teamRosterMap = useMemo(() => ({ [selectedTeam]: teamRoster ?? {} }), [selectedTeam, teamRoster]);
  const teamMembersByTeam = useMemo(() => projectTeamMembersByTeam(teamRosterMap), [teamRosterMap]);
  const teamMembersMessageByTeam = useMemo(() => projectTeamMembersMessageByTeam(teamRosterMap), [teamRosterMap]);
  const teamMembersBusyByTeam = useMemo(() => projectTeamMembersBusyByTeam(teamRosterMap), [teamRosterMap]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const hasSelectedRoom = selectedRoom != null;
  const inspectorTab = selectedRoom ? (historyPresence?.inspectorTab ?? "files") : "files";
  const secretWarningVisible =
    selectedRoom != null &&
    (codexRuntime?.secretWarningVisible ?? !hasAcknowledgedRoomVisibilityWarning(selectedRoom.id));
  const roomTerminals = useMemo(
    () => (selectedRoom ? terminals.filter((terminal) => terminal.roomId === selectedRoom.id) : []),
    [terminals, selectedRoom]
  );
  const markdownSelection = useMarkdownSelection({
    activeRoomId: selectedRoom?.id ?? null,
    enabled: hasSelectedRoom,
    resetKey: selectedRoomId
  });
  const selectedTeamRecord = teams.find((team) => team.id === selectedTeam) ?? null;
  const selectedTeamName = selectedTeamRecord?.name ?? (teams.length ? "No team selected" : "No teams yet");
  const selectedTeamMembers = teamMembersByTeam[selectedTeam] ?? [];
  const selectedTeamMembersMessage = teamMembersMessageByTeam[selectedTeam] ?? null;
  const selectedTeamMembersBusy = teamMembersBusyByTeam[selectedTeam] ?? false;
  const selectedTeamMemberRows = buildTeamMemberRows({
    members: selectedTeamMembers,
    team: selectedTeamRecord,
    currentUser: githubAuth.currentUser,
    localUserId: localIdentity.localUser.id
  });
  const roomValues = useSelectedRoomValues({
    selectedRoom,
    selectedMessageIds: markdownSelection.selectedMessageIds,
    markdownSelectionMode: markdownSelection.markdownSelectionMode,
    roomSettings,
    messages,
    roomChat,
    codexRuntime,
    browser,
    gitRuntime,
    terminalRuntime,
    filePanel,
    invite,
    historyMessage: historyPresence?.historyMessage,
    teamHistoryMessage: teamHistory?.message,
    defaultBrowserUrl,
    defaultBrowserReason
  });

  return {
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals,
    ...markdownSelection,
    selectedTeamRecord,
    selectedTeamName,
    selectedTeamMembers,
    selectedTeamMembersMessage,
    selectedTeamMembersBusy,
    selectedTeamMemberRows,
    ...roomValues
  };
}

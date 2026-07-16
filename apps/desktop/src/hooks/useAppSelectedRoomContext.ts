import { useAppSelectedContext } from "./useAppSelectedContext";
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

  return useAppSelectedContext({
    roomContext: {
      rooms,
      selectedRoomId,
      inspectorTab: historyPresence?.inspectorTab,
      secretWarningVisible: codexRuntime?.secretWarningVisible,
      terminals
    },
    markdownSelection: {
      resetKey: selectedRoomId
    },
    teamData: {
      teams,
      selectedTeam,
      teamMembersByTeam,
      teamMembersMessageByTeam,
      teamMembersBusyByTeam,
      currentUser: githubAuth.currentUser,
      localUserId: localIdentity.localUser.id
    },
    roomValues: {
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
    }
  });
}

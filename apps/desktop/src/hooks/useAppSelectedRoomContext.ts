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
type AppSelectedContextOptions = Parameters<typeof useAppSelectedContext>[0];

export function useAppSelectedRoomContext({
  githubAuth,
  localIdentity,
  fallbackRoom,
  defaultBrowserUrl,
  defaultBrowserReason
}: {
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  fallbackRoom: AppSelectedContextOptions["roomContext"]["fallbackRoom"];
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}) {
  const selectedState = useAppStore(
    useShallow((state) => {
      const roomId =
        state.rooms.find((room) => room.id === state.selectedRoomId)?.id ?? state.rooms[0]?.id ?? fallbackRoom.id;
      return {
        rooms: state.rooms,
        teams: state.teams,
        selectedRoomId: state.selectedRoomId,
        selectedTeam: state.selectedTeam,
        roomId,
        teamRoster: state.teamRosterByTeam[state.selectedTeam],
        messages: state.messagesByRoom[roomId],
        roomChat: state.roomChatByRoom[roomId],
        roomSettings: state.roomSettingsByRoom[roomId],
        codexRuntime: state.codexRuntimeByRoom[roomId],
        browser: state.browserByRoom[roomId],
        gitRuntime: state.gitWorkflowRuntimeByRoom[roomId],
        terminalRuntime: state.terminalRuntimeByRoom[roomId],
        filePanel: state.filePanelByRoom[roomId],
        invite: state.inviteByRoom[roomId],
        historyPresence: state.historyPresenceByRoom[roomId],
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
    roomId,
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
      fallbackRoom,
      inspectorTabsByRoom: activeMap(roomId, historyPresence?.inspectorTab),
      secretWarningsVisibleByRoom: activeMap(roomId, codexRuntime?.secretWarningVisible),
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
      selectedRoomId,
      selectedTeam,
      roomSettingsByRoom: activeMap(roomId, roomSettings),
      messagesByRoom: activeMap(roomId, messages),
      roomChatByRoom: activeMap(roomId, roomChat),
      codexRuntimeByRoom: activeMap(roomId, codexRuntime),
      browserByRoom: activeMap(roomId, browser),
      gitWorkflowRuntimeByRoom: activeMap(roomId, gitRuntime),
      terminalRuntimeByRoom: activeMap(roomId, terminalRuntime),
      filePanelByRoom: activeMap(roomId, filePanel),
      inviteByRoom: activeMap(roomId, invite),
      historyMessagesByRoom: activeMap(roomId, historyPresence?.historyMessage ?? null),
      teamHistoryMessagesByTeam: activeMap(selectedTeam, teamHistory?.message ?? null),
      defaultBrowserUrl,
      defaultBrowserReason
    }
  });
}

function activeMap<T>(key: string, value: T | null | undefined): Record<string, T> {
  return value == null ? {} : { [key]: value };
}

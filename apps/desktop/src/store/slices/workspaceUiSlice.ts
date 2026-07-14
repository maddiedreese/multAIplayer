import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { StateCreator } from "zustand";
import { ensureRoomDefaults } from "../../lib/roomDefaults";
import {
  applyLocalRoomReadState,
  markRoomRead as markRoomReadRecord,
  markRoomUnreadForIncomingChat,
  replaceRoomPreservingUnread,
  upsertRoomPreservingUnread
} from "../../lib/roomUnread";
import type { LocalRoomReadState, SidebarPanel } from "../../types";
import type { AppStoreState } from "../appStore";

export interface WorkspaceUiInitialState {
  teams: TeamRecord[];
  rooms: RoomRecord[];
  projectPath: string;
  roomId: string;
}

export interface WorkspaceUiSlice {
  workspaceUiInitialized: boolean;
  workspaceBootstrapStatus: "loading" | "ready" | "error";
  workspaceBootstrapError: string | null;
  workspaceBootstrapAttempt: number;
  teams: TeamRecord[];
  rooms: RoomRecord[];
  workspaceError: string | null;
  activeSidebarPanel: SidebarPanel;
  newTeamName: string;
  newRoomName: string;
  newRoomProjectPath: string;
  selectedTeam: string;
  selectedRoomId: string;
  sidebarQuery: string;
  initializeWorkspaceUi: (initialState: WorkspaceUiInitialState) => void;
  replaceTeams: (teams: TeamRecord[]) => void;
  updateTeamRoleForTeam: (teamId: string, role: TeamRecord["role"] | undefined) => void;
  updateTeamMemberCountForTeam: (teamId: string, members: number) => void;
  upsertTeamRecord: (team: TeamRecord) => void;
  replaceRooms: (rooms: RoomRecord[]) => void;
  upsertRoomRecord: (room: RoomRecord) => void;
  replaceRoomRecord: (room: RoomRecord) => void;
  markRoomReadById: (roomId: string) => void;
  hydrateRoomReadState: (roomId: string, readState?: LocalRoomReadState) => void;
  markIncomingChatUnread: (roomId: string, activeRoomId: string, senderDeviceId: string, localDeviceId: string) => void;
  setWorkspaceStatusError: (message: string | null) => void;
  beginWorkspaceBootstrap: () => void;
  completeWorkspaceBootstrap: () => void;
  failWorkspaceBootstrap: (message: string) => void;
  retryWorkspaceBootstrap: () => void;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;
  setNewTeamName: (name: string) => void;
  setNewRoomName: (name: string) => void;
  setNewRoomProjectPath: (path: string) => void;
  setSelectedTeam: (teamId: string) => void;
  selectExistingTeamOrFirst: (teams: TeamRecord[]) => void;
  setSelectedRoomId: (roomId: string) => void;
  selectExistingRoomOrFirst: (rooms: RoomRecord[]) => void;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
  selectTeamRoom: (teamId: string, fallbackRoomId: string) => void;
  setSidebarQuery: (query: string) => void;
}

export const emptyWorkspaceUiState: Pick<
  WorkspaceUiSlice,
  | "workspaceUiInitialized"
  | "workspaceBootstrapStatus"
  | "workspaceBootstrapError"
  | "workspaceBootstrapAttempt"
  | "teams"
  | "rooms"
  | "workspaceError"
  | "activeSidebarPanel"
  | "newTeamName"
  | "newRoomName"
  | "newRoomProjectPath"
  | "selectedTeam"
  | "selectedRoomId"
  | "sidebarQuery"
> = {
  workspaceUiInitialized: false,
  workspaceBootstrapStatus: "loading",
  workspaceBootstrapError: null,
  workspaceBootstrapAttempt: 0,
  teams: [],
  rooms: [],
  workspaceError: null,
  activeSidebarPanel: null,
  newTeamName: "",
  newRoomName: "",
  newRoomProjectPath: "",
  selectedTeam: "",
  selectedRoomId: "",
  sidebarQuery: ""
};

function activeRecords<T extends { deletedAt?: string }>(records: T[]): T[] {
  return records.filter((record) => !record.deletedAt);
}

function existingIdOrFirst<T extends { id: string }>(records: T[], currentId: string): string {
  return records.some((record) => record.id === currentId) ? currentId : (records[0]?.id ?? "");
}

export const createWorkspaceUiSlice: StateCreator<AppStoreState, [], [], WorkspaceUiSlice> = (set) => ({
  ...emptyWorkspaceUiState,
  initializeWorkspaceUi: ({ teams, rooms, projectPath, roomId }) => {
    set((state) => {
      if (state.workspaceUiInitialized) return state;
      return {
        workspaceUiInitialized: true,
        teams,
        rooms,
        newRoomProjectPath: projectPath,
        selectedTeam: teams[0]?.id ?? "",
        selectedRoomId: existingIdOrFirst(rooms, roomId)
      };
    });
  },
  replaceTeams: (teams) => {
    set((state) => {
      const nextTeams = activeRecords(teams);
      return {
        teams: nextTeams,
        selectedTeam: existingIdOrFirst(nextTeams, state.selectedTeam)
      };
    });
  },
  updateTeamRoleForTeam: (teamId, role) => {
    set((state) => ({
      teams: state.teams.map((team) => (team.id === teamId ? { ...team, role: role ?? team.role } : team))
    }));
  },
  updateTeamMemberCountForTeam: (teamId, members) => {
    set((state) => ({
      teams: state.teams.map((team) => (team.id === teamId ? { ...team, members } : team))
    }));
  },
  upsertTeamRecord: (team) => {
    set((state) => {
      const teams = team.deletedAt
        ? state.teams.filter((item) => item.id !== team.id)
        : state.teams.some((item) => item.id === team.id)
          ? state.teams.map((item) => (item.id === team.id ? team : item))
          : [...state.teams, team];
      return {
        teams,
        selectedTeam: existingIdOrFirst(teams, state.selectedTeam)
      };
    });
  },
  replaceRooms: (rooms) => {
    set((state) => {
      const nextRooms = activeRecords(rooms);
      return {
        rooms: nextRooms,
        selectedRoomId: existingIdOrFirst(nextRooms, state.selectedRoomId)
      };
    });
  },
  upsertRoomRecord: (room) => {
    set((state) => {
      const rooms = room.deletedAt
        ? state.rooms.filter((item) => item.id !== room.id)
        : upsertRoomPreservingUnread(state.rooms, ensureRoomDefaults(room));
      return {
        rooms,
        selectedRoomId: existingIdOrFirst(rooms, state.selectedRoomId)
      };
    });
  },
  replaceRoomRecord: (room) => {
    set((state) => {
      const rooms = room.deletedAt
        ? state.rooms.filter((item) => item.id !== room.id)
        : replaceRoomPreservingUnread(state.rooms, ensureRoomDefaults(room));
      return {
        rooms,
        selectedRoomId: existingIdOrFirst(rooms, state.selectedRoomId)
      };
    });
  },
  markRoomReadById: (roomId) => {
    set((state) => ({ rooms: markRoomReadRecord(state.rooms, roomId) }));
  },
  hydrateRoomReadState: (roomId, readState) => {
    set((state) => ({ rooms: applyLocalRoomReadState(state.rooms, roomId, readState) }));
  },
  markIncomingChatUnread: (roomId, activeRoomId, senderDeviceId, localDeviceId) => {
    set((state) => ({
      rooms: markRoomUnreadForIncomingChat(state.rooms, roomId, activeRoomId, senderDeviceId, localDeviceId)
    }));
  },
  setWorkspaceStatusError: (workspaceError) => set({ workspaceError }),
  beginWorkspaceBootstrap: () =>
    set({
      workspaceBootstrapStatus: "loading",
      workspaceBootstrapError: null
    }),
  completeWorkspaceBootstrap: () =>
    set({
      workspaceBootstrapStatus: "ready",
      workspaceBootstrapError: null
    }),
  failWorkspaceBootstrap: (workspaceBootstrapError) =>
    set({
      workspaceBootstrapStatus: "error",
      workspaceBootstrapError
    }),
  retryWorkspaceBootstrap: () =>
    set((state) => ({
      workspaceBootstrapStatus: "loading",
      workspaceBootstrapError: null,
      workspaceBootstrapAttempt: state.workspaceBootstrapAttempt + 1
    })),
  setActiveSidebarPanel: (activeSidebarPanel) => set({ activeSidebarPanel }),
  setNewTeamName: (newTeamName) => set({ newTeamName }),
  setNewRoomName: (newRoomName) => set({ newRoomName }),
  setNewRoomProjectPath: (newRoomProjectPath) => set({ newRoomProjectPath }),
  setSelectedTeam: (selectedTeam) => set({ selectedTeam }),
  selectExistingTeamOrFirst: (teams) => {
    const nextTeams = activeRecords(teams);
    set((state) => ({ selectedTeam: existingIdOrFirst(nextTeams, state.selectedTeam) }));
  },
  setSelectedRoomId: (selectedRoomId) => set({ selectedRoomId }),
  selectExistingRoomOrFirst: (rooms) => {
    const nextRooms = activeRecords(rooms);
    set((state) => ({ selectedRoomId: existingIdOrFirst(nextRooms, state.selectedRoomId) }));
  },
  selectWorkspaceRoom: (selectedTeam, selectedRoomId) => set({ selectedTeam, selectedRoomId }),
  selectTeamRoom: (selectedTeam, fallbackRoomId) => {
    set((state) => ({
      selectedTeam,
      selectedRoomId: state.rooms.find((room) => room.teamId === selectedTeam)?.id ?? fallbackRoomId
    }));
  },
  setSidebarQuery: (sidebarQuery) => set({ sidebarQuery })
});

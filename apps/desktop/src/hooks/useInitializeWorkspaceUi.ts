import { useLayoutEffect } from "react";
import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { ChatMessage } from "../types";
import { useAppStore } from "../store/appStore";

export interface WorkspaceUiSeed {
  initialTeams: TeamRecord[];
  initialRooms: RoomRecord[];
  initialTeamMembersByTeam: Record<string, TeamMemberRecord[]>;
  initialProjectPath: string;
  initialRoomId: string;
  initialMessagesByRoom: Record<string, ChatMessage[]>;
}

/**
 * Bridges React-provided starter data into the store. Components should subscribe
 * to the workspace fields they own directly with narrow `useAppStore` selectors.
 */
export function useInitializeWorkspaceUi({
  initialTeams,
  initialRooms,
  initialTeamMembersByTeam,
  initialProjectPath,
  initialRoomId,
  initialMessagesByRoom
}: WorkspaceUiSeed): void {
  useLayoutEffect(() => {
    const store = useAppStore.getState();
    store.initializeWorkspaceUi({
      teams: initialTeams,
      rooms: initialRooms,
      projectPath: initialProjectPath,
      roomId: initialRoomId
    });
    store.seedWorkspaceInitialDataIfEmpty({
      teamMembersByTeam: initialTeamMembersByTeam,
      messagesByRoom: initialMessagesByRoom
    });
  }, [
    initialMessagesByRoom,
    initialProjectPath,
    initialRoomId,
    initialRooms,
    initialTeamMembersByTeam,
    initialTeams,
  ]);
}

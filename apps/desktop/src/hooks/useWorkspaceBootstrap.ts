import { useEffect } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { loadWorkspace } from "../lib/workspaceClient";
import { ensureRoomDefaults } from "../lib/roomDefaults";

interface UseWorkspaceBootstrapOptions {
  relayHttpUrl: string;
  replaceTeams: (teams: TeamRecord[]) => void;
  replaceRooms: (rooms: RoomRecord[]) => void;
  selectExistingTeamOrFirst: (teams: TeamRecord[]) => void;
  selectExistingRoomOrFirst: (rooms: RoomRecord[]) => void;
  setWorkspaceStatusError: (message: string | null) => void;
}

export function useWorkspaceBootstrap({
  relayHttpUrl,
  replaceTeams,
  replaceRooms,
  selectExistingTeamOrFirst,
  selectExistingRoomOrFirst,
  setWorkspaceStatusError
}: UseWorkspaceBootstrapOptions) {
  useEffect(() => {
    loadWorkspace()
      .then((snapshot) => {
        const nextRooms = snapshot.rooms.map(ensureRoomDefaults);
        replaceTeams(snapshot.teams);
        replaceRooms(nextRooms);
        selectExistingTeamOrFirst(snapshot.teams);
        selectExistingRoomOrFirst(nextRooms);
        setWorkspaceStatusError(null);
      })
      .catch((error) => {
        setWorkspaceStatusError(`Could not load the relay workspace: ${String(error)}`);
      });
  }, [
    relayHttpUrl,
    replaceRooms,
    replaceTeams,
    selectExistingRoomOrFirst,
    selectExistingTeamOrFirst,
    setWorkspaceStatusError
  ]);
}

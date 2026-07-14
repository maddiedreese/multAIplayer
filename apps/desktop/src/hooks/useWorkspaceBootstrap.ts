import { useEffect } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { loadWorkspace } from "../lib/workspaceClient";
import { ensureRoomDefaults } from "../lib/roomDefaults";

interface UseWorkspaceBootstrapOptions {
  relayHttpUrl: string;
  bootstrapAttempt: number;
  replaceTeams: (teams: TeamRecord[]) => void;
  replaceRooms: (rooms: RoomRecord[]) => void;
  selectExistingTeamOrFirst: (teams: TeamRecord[]) => void;
  selectExistingRoomOrFirst: (rooms: RoomRecord[]) => void;
  setWorkspaceStatusError: (message: string | null) => void;
  beginWorkspaceBootstrap: () => void;
  completeWorkspaceBootstrap: () => void;
  failWorkspaceBootstrap: (message: string) => void;
}

export function useWorkspaceBootstrap({
  relayHttpUrl,
  bootstrapAttempt,
  replaceTeams,
  replaceRooms,
  selectExistingTeamOrFirst,
  selectExistingRoomOrFirst,
  setWorkspaceStatusError,
  beginWorkspaceBootstrap,
  completeWorkspaceBootstrap,
  failWorkspaceBootstrap
}: UseWorkspaceBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;
    beginWorkspaceBootstrap();
    loadWorkspace()
      .then((snapshot) => {
        if (cancelled) return;
        const nextRooms = snapshot.rooms.map(ensureRoomDefaults);
        replaceTeams(snapshot.teams);
        replaceRooms(nextRooms);
        selectExistingTeamOrFirst(snapshot.teams);
        selectExistingRoomOrFirst(nextRooms);
        setWorkspaceStatusError(null);
        completeWorkspaceBootstrap();
      })
      .catch((error) => {
        if (cancelled) return;
        const message = `Could not load the relay workspace: ${String(error)}`;
        setWorkspaceStatusError(message);
        failWorkspaceBootstrap(message);
      });
    return () => {
      cancelled = true;
    };
  }, [
    beginWorkspaceBootstrap,
    bootstrapAttempt,
    completeWorkspaceBootstrap,
    failWorkspaceBootstrap,
    relayHttpUrl,
    replaceRooms,
    replaceTeams,
    selectExistingRoomOrFirst,
    selectExistingTeamOrFirst,
    setWorkspaceStatusError
  ]);
}

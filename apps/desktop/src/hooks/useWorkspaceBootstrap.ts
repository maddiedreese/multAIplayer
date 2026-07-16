import { useEffect } from "react";
import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { loadWorkspace } from "../application/workspace/workspaceClient";

interface UseWorkspaceBootstrapOptions {
  relayHttpUrl: string;
  /**
   * A signed-in identity changes the authorization available to `/teams`.
   * Keeping this nullable preserves the single anonymous bootstrap used by
   * LAN/self-hosted relays while allowing a failed pre-login request to rerun
   * once after Device Flow completes.
   */
  authenticatedUserId: string | null;
  bootstrapAttempt: number;
  replaceTeams: (teams: TeamRecord[]) => void;
  replaceRooms: (rooms: ClientRoomRecord[]) => void;
  selectExistingTeamOrFirst: (teams: TeamRecord[]) => void;
  selectExistingRoomOrFirst: (rooms: ClientRoomRecord[]) => void;
  setWorkspaceStatusError: (message: string | null) => void;
  beginWorkspaceBootstrap: () => void;
  completeWorkspaceBootstrap: () => void;
  failWorkspaceBootstrap: (message: string) => void;
}

export function useWorkspaceBootstrap({
  relayHttpUrl,
  authenticatedUserId,
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
        const nextRooms = snapshot.rooms;
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
    authenticatedUserId,
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

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { loadWorkspace } from "../lib/workspaceClient";
import { ensureRoomDefaults } from "../lib/roomDefaults";

interface UseWorkspaceBootstrapOptions {
  relayHttpUrl: string;
  setTeams: Dispatch<SetStateAction<TeamRecord[]>>;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  setSelectedTeam: Dispatch<SetStateAction<string>>;
  setSelectedRoomId: Dispatch<SetStateAction<string>>;
  setWorkspaceError: Dispatch<SetStateAction<string | null>>;
}

export function useWorkspaceBootstrap({
  relayHttpUrl,
  setTeams,
  setRooms,
  setSelectedTeam,
  setSelectedRoomId,
  setWorkspaceError
}: UseWorkspaceBootstrapOptions) {
  useEffect(() => {
    loadWorkspace()
      .then((snapshot) => {
        const nextRooms = snapshot.rooms.map(ensureRoomDefaults);
        setTeams(snapshot.teams);
        setRooms(nextRooms);
        setSelectedTeam((current) =>
          snapshot.teams.some((team) => team.id === current) ? current : snapshot.teams[0]?.id ?? ""
        );
        setSelectedRoomId((current) =>
          nextRooms.some((room) => room.id === current) ? current : nextRooms[0]?.id ?? ""
        );
        setWorkspaceError(null);
      })
      .catch((error) => {
        setWorkspaceError(`Using local starter rooms: ${String(error)}`);
      });
  }, [relayHttpUrl, setRooms, setSelectedRoomId, setSelectedTeam, setTeams, setWorkspaceError]);
}

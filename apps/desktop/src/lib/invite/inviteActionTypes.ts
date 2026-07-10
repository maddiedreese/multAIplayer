import type { MutableRefObject } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { RelayClient } from "../relayClient";

export interface UseInviteActionsOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  reportRoomKeyRotationInFlight: (roomId: string) => boolean;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: RoomRecord) => void;
  clearInviteSecretInput: () => void;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
}

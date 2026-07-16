import type { MutableRefObject } from "react";
import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { RelayClient } from "../../lib/relay/relayClient";

export interface UseInviteActionsOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  reportMembershipCommitInFlight: (roomId: string) => boolean;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: ClientRoomRecord) => void;
  clearInviteSecretInput: () => void;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
}

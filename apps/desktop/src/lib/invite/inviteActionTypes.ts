import type { MutableRefObject } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { DeviceIdentity } from "../deviceIdentity";
import type { RelayClient } from "../relayClient";
import type { InviteJoinRequest, RelayStatus } from "../../types";

export interface LocalUser {
  id: string;
  name: string;
}

export interface UseInviteActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  hostGateMessage: string;
  inviteApprovalGate: boolean;
  inviteRequests: InviteJoinRequest[];
  inviteSecretInput: string;
  localUser: LocalUser;
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  reportRoomKeyRotationInFlight: (roomId: string) => boolean;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: RoomRecord) => void;
  clearInviteSecretInput: () => void;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
}

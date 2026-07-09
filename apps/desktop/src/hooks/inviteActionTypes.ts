import type { MutableRefObject } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import type { RelayClient } from "../lib/relayClient";
import type { ChatMessage, InviteJoinRequest, RelayStatus } from "../types";

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
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  setSelectedInviteMessage: (message: string | null) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  clearInviteSecretInput: () => void;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
  rememberForgottenRoom: (roomId: string) => void;
  restoreForgottenRoom: (roomId: string) => void;
  restoreWorkspaceAccess: (teamId: string, roomId: string) => void;
  setKeyRotationBusyForRoom: (roomId: string, busy: boolean) => void;
}

export type InviteAdmissionStoreActions = {
  setInviteAdmissionForRoom: (roomId: string, inviteId: string) => void;
  initializeMessagesForRoom: (roomId: string) => void;
};

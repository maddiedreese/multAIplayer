import type { MutableRefObject } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { RelayClient } from "../../lib/relay/relayClient";
import type { BrowserAccessRequest, ChatMessage, HostHandoffRecord, QueuedCodexTurn, RelayStatus } from "../../types";
import type { GitStatusSummary, TerminalSnapshot } from "../../lib/platform/localBackend";

export interface UseHostHandoffActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: ClientRoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  hostGateMessage: string;
  hostHandoffs: HostHandoffRecord[];
  queuedCodexTurns: QueuedCodexTurn[];
  localUser: { id: string; name: string };
  deviceId: string;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  messages: ChatMessage[];
  terminals: TerminalSnapshot[];
  browserRequests: BrowserAccessRequest[];
  gitStatus: GitStatusSummary | null;
  reportRoomHostMutationInFlight: (roomId: string) => boolean;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
  replaceRoom: (room: ClientRoomRecord) => void;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedHostMessage: (message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string) => void;
  setCustomCodexModelForRoom: (roomId: string, codexModel: string) => void;
  resetFileContextForRoom: (roomId: string) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  getHostHandoffSnapshot: () => HostHandoffAuthorizationSnapshot;
}

export interface HostHandoffAuthorizationSnapshot {
  selectedRoomId: string;
  room: ClientRoomRecord | null;
  isActiveHost: boolean;
  hostHandoffs: HostHandoffRecord[];
}

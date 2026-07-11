import type { MutableRefObject } from "react";
import type { CodexEventPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import type { CodexProbe, GitStatusSummary, TerminalSnapshot } from "../lib/localBackend";
import type {
  BrowserAccessRequest,
  ChatMessage,
  HostHandoffRecord,
  PendingCodexApproval,
  QueuedCodexTurn
} from "../types";

export interface UseCodexTurnActionsOptions {
  selectedRoom: RoomRecord;
  codexProbe: CodexProbe | null;
  activeCodexApproval: PendingCodexApproval | null;
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  localUser: { id: string; name: string };
  messagesByRoom: Record<string, ChatMessage[]>;
  terminals: TerminalSnapshot[];
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
  gitStatusByRoom: Record<string, GitStatusSummary | null>;
  codexContinuationByRoom: Record<string, HostHandoffRecord>;
  codexThreadIdsByRoom: Record<string, string>;
  queuedCodexApprovalsByRoom: Record<string, QueuedCodexTurn[]>;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  removeQueuedCodexApprovalForRoom: (roomId: string, turnId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  replaceRoom: (room: RoomRecord) => void;
  publishCodexEvent: (
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room?: RoomRecord
  ) => Promise<void>;
  publishChatMessage: (message: ChatMessage, room?: RoomRecord) => Promise<void>;
  publishHostHandoff: (
    room: RoomRecord,
    reason?: HostHandoffRecord["reason"],
    handoffMessages?: ChatMessage[]
  ) => Promise<void>;
}

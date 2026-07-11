import type { CodexEventPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import type { ChatMessage, HostHandoffRecord } from "../types";

export interface UseCodexTurnActionsOptions {
  localUser: { id: string; name: string };
  maxTerminalActivityLines: number;
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

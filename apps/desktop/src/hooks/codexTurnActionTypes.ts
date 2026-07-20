import type { CodexEventPlaintextPayload, ClientRoomRecord } from "@multaiplayer/protocol";
import type { ChatMessage, HostHandoffRecord } from "../types";

export interface UseCodexTurnActionsOptions {
  localUser: { id: string; name: string };
  deviceId: string;
  maxTerminalActivityLines: number;
  replaceRoom: (room: ClientRoomRecord) => void;
  publishCodexEvent: (
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room?: ClientRoomRecord
  ) => Promise<void>;
  publishChatMessage: (message: ChatMessage, room?: ClientRoomRecord) => Promise<void>;
  publishHostHandoff: (
    room: ClientRoomRecord,
    reason?: HostHandoffRecord["reason"],
    handoffMessages?: ChatMessage[]
  ) => Promise<void>;
}

import type { RoomRecord } from "@multaiplayer/protocol";
import { codexUsageLimitMessage } from "../lib/codexFailure";
import { formatMessageTime } from "../lib/appFormatters";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import type { ChatMessage, HostHandoffRecord } from "../types";

interface CodexUsageLimitContext {
  localUserId: string;
  selectedRoomId: () => string;
  publishCodexEvent: (
    event: { turnId: string; status: "failed"; message: string; model: string },
    room: RoomRecord
  ) => Promise<void>;
  appendTerminalLines: (roomId: string, lines: string[]) => void;
  publishChatMessage: (message: ChatMessage, room: RoomRecord) => Promise<void>;
  replaceRoom: (room: RoomRecord) => void;
  publishHostHandoff: (room: RoomRecord, reason: HostHandoffRecord["reason"], messages: ChatMessage[]) => Promise<void>;
  setHostMessage: (roomId: string, message: string) => void;
}

export async function handleCodexUsageLimit(
  context: CodexUsageLimitContext,
  room: RoomRecord,
  turnId: string,
  model: string,
  turnMessages: ChatMessage[],
  events: string[],
  stderr: string
): Promise<void> {
  const roomId = room.id;
  const message = codexUsageLimitMessage(room.host);
  await context.publishCodexEvent({ turnId, status: "failed", message, model }, room);
  context.appendTerminalLines(roomId, [
    message,
    ...events.slice(-4).map((event) => `event: ${event}`),
    ...(stderr ? [`stderr: ${stderr}`] : [])
  ]);
  await context.publishChatMessage(
    {
      id: crypto.randomUUID(),
      author: "multAIplayer",
      role: "system",
      body: `${message} Click Continue with another host in the room panel to keep going from this room context.`,
      time: formatMessageTime(),
      createdAt: new Date().toISOString()
    },
    room
  );
  await context.publishHostHandoff(room, "usage_limit", turnMessages);
  if (shouldApplyRoomScopedUiUpdate(context.selectedRoomId(), roomId)) context.setHostMessage(roomId, message);
}

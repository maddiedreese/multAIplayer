import type { CodexRoomEvent, ChatMessage } from "../types";

export function codexConsumedMessageIds(events: readonly CodexRoomEvent[] = []): Set<string> {
  const consumed = new Set<string>();
  for (const event of events) {
    if (event.status !== "started") continue;
    for (const messageId of event.consumedMessageIds ?? []) {
      consumed.add(messageId);
    }
  }
  return consumed;
}

export function messageIsBeforeCodexWatermark(
  message: Pick<ChatMessage, "id" | "createdAt">,
  events: readonly CodexRoomEvent[] = []
): boolean {
  const consumedIds = codexConsumedMessageIds(events);
  if (consumedIds.has(message.id)) return false;

  const latestStartedAt = latestCodexStartedAt(events.filter((event) => !event.consumedMessageIds?.length));
  if (!latestStartedAt) return true;
  if (!message.createdAt) return false;
  const messageTime = Date.parse(message.createdAt);
  const startedTime = Date.parse(latestStartedAt);
  if (!Number.isFinite(messageTime) || !Number.isFinite(startedTime)) return false;
  return messageTime > startedTime;
}

export function latestCodexStartedAt(events: readonly CodexRoomEvent[] = []): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.status !== "started") continue;
    const time = Date.parse(event.createdAt);
    if (!Number.isFinite(time) || time <= latestTime) continue;
    latest = event.createdAt;
    latestTime = time;
  }
  return latest;
}

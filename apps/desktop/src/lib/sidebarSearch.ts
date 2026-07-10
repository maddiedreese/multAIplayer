export interface SidebarSearchAttachment {
  name: string;
}

export interface SidebarSearchMessage {
  id: string;
  author: string;
  body: string;
  attachments?: SidebarSearchAttachment[];
}

export interface SidebarMessageHit<TMessage extends SidebarSearchMessage = SidebarSearchMessage> {
  roomId: string;
  message: TMessage;
}

export function mergeSearchableMessages<TMessage extends SidebarSearchMessage>(
  liveMessagesByRoom: Record<string, TMessage[]>,
  historyMessagesByRoom: Record<string, TMessage[]>
): Record<string, TMessage[]> {
  const merged = { ...historyMessagesByRoom };
  for (const [roomId, roomMessages] of Object.entries(liveMessagesByRoom)) {
    if (roomMessages.length) merged[roomId] = roomMessages;
  }
  return merged;
}

export function findSidebarMessageHits<TMessage extends SidebarSearchMessage>(
  messagesByRoom: Record<string, TMessage[]>,
  query: string,
  limit = 8
): SidebarMessageHit<TMessage>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  return Object.entries(messagesByRoom)
    .flatMap(([roomId, roomMessages]) =>
      roomMessages
        .filter((message) =>
          searchMatches(
            [message.author, message.body, message.attachments?.map((attachment) => attachment.name).join(" ") ?? ""],
            normalizedQuery
          )
        )
        .map((message) => ({ roomId, message }))
    )
    .slice(-limit);
}

export function searchMatches(values: string[], query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalizedQuery));
}

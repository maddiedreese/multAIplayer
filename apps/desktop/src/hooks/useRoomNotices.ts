import type { RoomNoticeDisplay } from "../components/RoomStatusBanners";

interface UseRoomNoticesOptions {
  roomId: string;
  hostMessage: string | null;
  chatMessage: string | null;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
}

export function useRoomNotices({
  roomId,
  hostMessage,
  chatMessage,
  setHostMessageForRoom,
  setChatMessageForRoom
}: UseRoomNoticesOptions): RoomNoticeDisplay[] {
  return [
    hostMessage
      ? { key: "host", label: "Codex", message: hostMessage, onDismiss: () => setHostMessageForRoom(roomId, null) }
      : null,
    chatMessage && chatMessage !== hostMessage
      ? { key: "chat", label: "Chat", message: chatMessage, onDismiss: () => setChatMessageForRoom(roomId, null) }
      : null
  ].filter((notice): notice is RoomNoticeDisplay => Boolean(notice));
}

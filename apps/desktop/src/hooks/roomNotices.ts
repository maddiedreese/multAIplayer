import type { RoomNoticeDisplay } from "../components/RoomStatusBanners";
import { useAppStore } from "../store/appStore";

interface BuildRoomNoticesOptions {
  roomId: string | null;
  hostMessage: string | null;
  chatMessage: string | null;
}

export function buildRoomNotices({ roomId, hostMessage, chatMessage }: BuildRoomNoticesOptions): RoomNoticeDisplay[] {
  return [
    hostMessage
      ? {
          key: "host",
          label: "Codex",
          message: hostMessage,
          onDismiss: roomId ? () => useAppStore.getState().setHostMessageForRoom(roomId, null) : undefined
        }
      : null,
    chatMessage && chatMessage !== hostMessage
      ? {
          key: "chat",
          label: "Chat",
          message: chatMessage,
          onDismiss: roomId ? () => useAppStore.getState().setChatMessageForRoom(roomId, null) : undefined
        }
      : null
  ].filter((notice): notice is RoomNoticeDisplay => Boolean(notice));
}

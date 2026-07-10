import type { RoomNoticeDisplay } from "../components/RoomStatusBanners";
import { useAppStore } from "../store/appStore";

interface BuildRoomNoticesOptions {
  roomId: string;
  hostMessage: string | null;
  chatMessage: string | null;
}

export function buildRoomNotices({
  roomId,
  hostMessage,
  chatMessage
}: BuildRoomNoticesOptions): RoomNoticeDisplay[] {
  return [
    hostMessage
      ? {
          key: "host",
          label: "Codex",
          message: hostMessage,
          onDismiss: () => useAppStore.getState().setHostMessageForRoom(roomId, null)
        }
      : null,
    chatMessage && chatMessage !== hostMessage
      ? {
          key: "chat",
          label: "Chat",
          message: chatMessage,
          onDismiss: () => useAppStore.getState().setChatMessageForRoom(roomId, null)
        }
      : null
  ].filter((notice): notice is RoomNoticeDisplay => Boolean(notice));
}

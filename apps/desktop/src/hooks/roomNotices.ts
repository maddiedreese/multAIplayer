import type { RoomNoticeDisplay } from "../components/RoomStatusBanners";
import { useAppStore } from "../store/appStore";

interface BuildRoomNoticesOptions {
  roomId: string | null;
  hostMessage: string | null;
  chatMessage: string | null;
}

export function buildRoomNotices({ roomId, hostMessage, chatMessage }: BuildRoomNoticesOptions): RoomNoticeDisplay[] {
  return [
    hostMessage && isActionableRoomNotice(hostMessage)
      ? {
          key: "host",
          label: "Codex",
          message: hostMessage,
          onDismiss: roomId ? () => useAppStore.getState().setHostMessageForRoom(roomId, null) : undefined
        }
      : null,
    chatMessage && chatMessage !== hostMessage && isActionableRoomNotice(chatMessage)
      ? {
          key: "chat",
          label: "Chat",
          message: chatMessage,
          onDismiss: roomId ? () => useAppStore.getState().setChatMessageForRoom(roomId, null) : undefined
        }
      : null
  ].filter((notice): notice is RoomNoticeDisplay => Boolean(notice));
}

const actionableNoticePattern =
  /\b(?:warning|error|failed|failure|denied|rejected|locked|revoked|expired|timed out|unavailable|missing|invalid|could not|cannot|can't|must|required|only|waiting|rejoin|dropped|disabled|no longer|not connected|not available|not supported|not approved|not authenticated)\b/i;

/** Routine success/status messages stay in their owning surface instead of becoming global room toasts. */
export function isActionableRoomNotice(message: string): boolean {
  return actionableNoticePattern.test(message);
}

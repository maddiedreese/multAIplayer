import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { MutableRefObject } from "react";
import type { ChatMessage } from "../../types";
import { reportNonFatal } from "../core/nonFatalReporting";
import { isTauriRuntime } from "../platform/localBackend/runtime";

const maxNotificationBodyChars = 180;

type PluginListener = { unregister: () => void };

export interface RoomNotificationInput {
  relayOpen: boolean;
  room: ClientRoomRecord | undefined;
  message: ChatMessage;
  selectedRoomId: string | null;
  localDeviceId: string;
  senderDeviceId: string;
  localUserId: string;
  senderUserId: string;
  mutedRoomIds: ReadonlySet<string>;
  forgottenRoomIds: ReadonlySet<string>;
  revokedRoomIds: ReadonlySet<string>;
  revokedTeamIds: ReadonlySet<string>;
}

export type RoomNotificationSuppressionReason =
  "relay_closed" | "missing_room" | "focused_room" | "local_sender" | "muted" | "locked";

export type RoomNotificationEligibility =
  { eligible: true } | { eligible: false; reason: RoomNotificationSuppressionReason };

function compactPreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncatePreview(value: string): string {
  if (value.length <= maxNotificationBodyChars) return value;
  return `${value.slice(0, maxNotificationBodyChars - 3).trimEnd()}...`;
}

export function buildRoomNotificationPreview(message: ChatMessage): string {
  const body = compactPreviewText(message.body);
  if (body) return truncatePreview(body);
  const attachmentCount = message.attachments?.length ?? 0;
  if (attachmentCount === 1) return "Shared an attachment.";
  if (attachmentCount > 1) return `Shared ${attachmentCount} attachments.`;
  return "Sent a message.";
}

export function roomNotificationTitle(room: ClientRoomRecord, message: ChatMessage): string {
  const author = compactPreviewText(message.author);
  return author ? `${author} in ${room.name}` : room.name;
}

export function getRoomNotificationEligibility({
  relayOpen,
  room,
  message,
  selectedRoomId,
  localDeviceId,
  senderDeviceId,
  localUserId,
  senderUserId,
  mutedRoomIds,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds
}: RoomNotificationInput): RoomNotificationEligibility {
  void message;
  if (!relayOpen) return { eligible: false, reason: "relay_closed" };
  if (!room) return { eligible: false, reason: "missing_room" };
  if (room.id === selectedRoomId) return { eligible: false, reason: "focused_room" };
  if (senderDeviceId === localDeviceId || senderUserId === localUserId) {
    return { eligible: false, reason: "local_sender" };
  }
  if (mutedRoomIds.has(room.id)) return { eligible: false, reason: "muted" };
  if (forgottenRoomIds.has(room.id) || revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId)) {
    return { eligible: false, reason: "locked" };
  }
  return { eligible: true };
}

export async function sendRoomMessageNotification(input: RoomNotificationInput): Promise<RoomNotificationEligibility> {
  const eligibility = getRoomNotificationEligibility(input);
  if (!eligibility.eligible || !isTauriRuntime()) return eligibility;
  const room = input.room;
  if (!room) return { eligible: false, reason: "missing_room" };

  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === "granted";
  }
  if (!permissionGranted) return eligibility;

  sendNotification({
    title: roomNotificationTitle(room, input.message),
    body: buildRoomNotificationPreview(input.message),
    group: room.id,
    autoCancel: true,
    extra: {
      roomId: room.id,
      teamId: room.teamId
    }
  });
  return eligibility;
}

export function roomIdFromNotificationExtra(extra: Record<string, unknown> | undefined): string | null {
  const roomId = extra?.roomId;
  return typeof roomId === "string" && roomId ? roomId : null;
}

export function registerRoomNotificationClickFocus({
  roomsRef,
  selectWorkspaceRoom
}: {
  roomsRef: MutableRefObject<ClientRoomRecord[]>;
  selectWorkspaceRoom: (teamId: string, roomId: string) => void;
}) {
  if (!isTauriRuntime()) return () => undefined;

  let listener: PluginListener | null = null;
  let disposed = false;
  void import("@tauri-apps/plugin-notification")
    .then(({ onAction }) =>
      onAction(async (notification) => {
        const roomId = roomIdFromNotificationExtra(notification.extra);
        if (!roomId) return;
        const room = roomsRef.current.find((item) => item.id === roomId);
        if (!room) return;
        selectWorkspaceRoom(room.teamId, room.id);
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        await currentWindow.show();
        await currentWindow.unminimize();
        await currentWindow.setFocus();
      }).then((registeredListener) => {
        if (disposed) {
          registeredListener.unregister();
          return;
        }
        listener = registeredListener;
      })
    )
    .catch((error) => {
      reportNonFatal("register room notification click handler", error);
    });

  return () => {
    disposed = true;
    listener?.unregister();
  };
}

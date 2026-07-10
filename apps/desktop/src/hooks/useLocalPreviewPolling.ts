import { useEffect } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { readLocalPreviewTunnelStatus } from "../lib/localBackend";
import type { LocalPreviewRecord } from "../types";

interface LatestRef<T> {
  current: T;
}

interface UseLocalPreviewPollingOptions {
  localPreviewsByRoom: Record<string, LocalPreviewRecord[]>;
  localUserId: string;
  roomsRef: LatestRef<RoomRecord[]>;
  publishLocalPreviewEvent: (payload: LocalPreviewRecord, room: RoomRecord) => Promise<void>;
}

export function useLocalPreviewPolling({
  localPreviewsByRoom,
  localUserId,
  roomsRef,
  publishLocalPreviewEvent
}: UseLocalPreviewPollingOptions) {
  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const [roomId, previews] of Object.entries(localPreviewsByRoom)) {
        const room = roomsRef.current.find((item) => item.id === roomId);
        if (!room) continue;
        for (const preview of previews) {
          if (preview.sharedByUserId !== localUserId || preview.status !== "live") continue;
          readLocalPreviewTunnelStatus(preview.id)
            .then((status) => {
              if (status.running && status.localReachable) return;
              void publishLocalPreviewEvent(
                {
                  ...preview,
                  status: "error",
                  message: status.running
                    ? "The local web server stopped responding. Stop sharing and restart the preview after the app is running again."
                    : `Cloudflare Quick Tunnel exited${status.exitStatus === null ? "" : ` with status ${status.exitStatus}`}.`,
                  updatedAt: new Date().toISOString()
                },
                room
              );
            })
            .catch((error) => {
              void publishLocalPreviewEvent(
                {
                  ...preview,
                  status: "error",
                  message: `Cloudflare Quick Tunnel is no longer running on this device: ${String(error)}`,
                  updatedAt: new Date().toISOString()
                },
                room
              );
            });
        }
      }
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [localPreviewsByRoom, localUserId, publishLocalPreviewEvent, roomsRef]);
}

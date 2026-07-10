import type { RoomRecord } from "@multaiplayer/protocol";
import {
  detectLocalPreviewServers,
  probeCloudflared,
  startLocalPreviewTunnel,
  stopLocalPreviewTunnel
} from "./localBackend";
import {
  localPreviewLabel,
  normalizeLocalPreviewUrl,
  quickTunnelDisclaimer
} from "./localPreview";
import { roomLockMessage } from "./appRuntime";
import { useAppStore } from "../store/appStore";
import type { LocalPreviewDialogState, LocalPreviewRecord } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface LocalPreviewActionsOptions {
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  selectedRoom: RoomRecord;
  rooms: RoomRecord[];
  localUser: LocalUser;
  localPreviewDialog: LocalPreviewDialogState;
  localPreviewsByRoom: Record<string, LocalPreviewRecord[]>;
  publishLocalPreviewEvent: (payload: LocalPreviewRecord, room?: RoomRecord) => Promise<void>;
}

export function createLocalPreviewActions({
  hasSelectedRoom,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  selectedRoom,
  rooms,
  localUser,
  localPreviewDialog,
  localPreviewsByRoom,
  publishLocalPreviewEvent
}: LocalPreviewActionsOptions) {
  async function openLocalPreviewDialog() {
    if (!hasSelectedRoom) return;
    if (isSelectedRoomLocked) {
      useAppStore.getState().setChatMessageForRoom(
        selectedRoom.id,
        roomLockMessage(selectedRoom, isSelectedRoomRevoked)
      );
      return;
    }
    useAppStore.getState().setLocalPreviewBusyForRoom(selectedRoom.id, true);
    useAppStore.getState().openLocalPreviewDialogForRoom(selectedRoom.id);
    try {
      const detected = await detectLocalPreviewServers();
      const candidates = detected.map((server) => ({
        url: server.url,
        label: localPreviewLabel(server.url)
      }));
      useAppStore.getState().setLocalPreviewDialogCandidates(
        candidates,
        candidates.length ? null : "No common local development servers were detected. Enter a local URL manually."
      );
    } catch (error) {
      useAppStore.getState().setLocalPreviewDialogError(`Could not detect local web servers: ${String(error)}`);
    } finally {
      useAppStore.getState().setLocalPreviewBusyForRoom(selectedRoom.id, false);
    }
  }

  async function prepareLocalPreviewConfirmation() {
    const room = rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom;
    const selectedUrl = localPreviewDialog.manualUrl.trim() || localPreviewDialog.selectedUrl;
    try {
      const normalizedUrl = normalizeLocalPreviewUrl(selectedUrl);
      useAppStore.getState().setLocalPreviewDialogError(null);
      useAppStore.getState().setLocalPreviewDialogSelectedUrl(normalizedUrl);
      const cloudflared = await probeCloudflared();
      if (!cloudflared.available) {
        useAppStore.getState().setLocalPreviewDialogPhase(
          "install",
          cloudflared.error ?? "cloudflared is not installed."
        );
        return;
      }
      useAppStore.getState().setLocalPreviewDialogConfirmation(room.id, normalizedUrl, cloudflared.version);
    } catch (error) {
      useAppStore.getState().setLocalPreviewDialogError(String(error));
    }
  }

  async function confirmLocalPreviewShare() {
    const room = rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom;
    const previewId = crypto.randomUUID();
    const sourceUrl = localPreviewDialog.selectedUrl;
    const now = new Date().toISOString();
    useAppStore.getState().setLocalPreviewDialogPhase("starting");
    useAppStore.getState().setLocalPreviewBusyForRoom(room.id, true);
    const startingPayload: LocalPreviewRecord = {
      eventType: "local.preview",
      id: previewId,
      sharedBy: localUser.name,
      sharedByUserId: localUser.id,
      sourceUrl,
      status: "starting",
      message: "Starting Cloudflare Quick Tunnel...",
      createdAt: now,
      updatedAt: now
    };
    await publishLocalPreviewEvent(startingPayload, room);
    try {
      const tunnel = await startLocalPreviewTunnel(previewId, sourceUrl);
      const livePayload: LocalPreviewRecord = {
        ...startingPayload,
        sourceUrl: tunnel.localUrl,
        publicUrl: tunnel.publicUrl,
        status: "live",
        message: quickTunnelDisclaimer,
        updatedAt: new Date().toISOString()
      };
      await publishLocalPreviewEvent(livePayload, room);
      useAppStore.getState().closeLocalPreviewDialog();
      useAppStore.getState().setChatMessageForRoom(room.id, `Shared local preview: ${tunnel.publicUrl}`);
    } catch (error) {
      const errorPayload: LocalPreviewRecord = {
        ...startingPayload,
        status: "error",
        message: String(error),
        updatedAt: new Date().toISOString()
      };
      await publishLocalPreviewEvent(errorPayload, room);
      useAppStore.getState().setLocalPreviewDialogPhase("select", String(error));
    } finally {
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopLocalPreview(previewId: string) {
    const room = selectedRoom;
    const preview = (localPreviewsByRoom[room.id] ?? []).find((item) => item.id === previewId);
    if (!preview) return;
    useAppStore.getState().setLocalPreviewBusyForRoom(room.id, true);
    try {
      await stopLocalPreviewTunnel(previewId);
      await publishLocalPreviewEvent({
        ...preview,
        status: "stopped",
        message: "This preview is no longer available.",
        updatedAt: new Date().toISOString()
      }, room);
    } catch (error) {
      await publishLocalPreviewEvent({
        ...preview,
        status: "error",
        message: `Tunnel process could not be terminated: ${String(error)}`,
        updatedAt: new Date().toISOString()
      }, room);
    } finally {
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopOwnedLocalPreviews(message = "This preview is no longer available.") {
    for (const [roomId, previews] of Object.entries(localPreviewsByRoom)) {
      const room = rooms.find((item) => item.id === roomId);
      if (!room) continue;
      for (const preview of previews) {
        if (preview.sharedByUserId !== localUser.id || (preview.status !== "live" && preview.status !== "starting")) continue;
        try {
          await stopLocalPreviewTunnel(preview.id);
        } catch {
          // The app may already be exiting or the tunnel may have already stopped.
        }
        await publishLocalPreviewEvent({
          ...preview,
          status: "stopped",
          message,
          updatedAt: new Date().toISOString()
        }, room);
      }
    }
  }

  return {
    openLocalPreviewDialog,
    prepareLocalPreviewConfirmation,
    confirmLocalPreviewShare,
    stopLocalPreview,
    stopOwnedLocalPreviews
  };
}

import type { Dispatch, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  detectLocalPreviewServers,
  probeCloudflared,
  startLocalPreviewTunnel,
  stopLocalPreviewTunnel
} from "../lib/localBackend";
import {
  localPreviewLabel,
  normalizeLocalPreviewUrl,
  quickTunnelDisclaimer
} from "../lib/localPreview";
import { roomLockMessage } from "../lib/appRuntime";
import type { LocalPreviewDialogState, LocalPreviewRecord } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseLocalPreviewActionsOptions {
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  selectedRoom: RoomRecord;
  rooms: RoomRecord[];
  localUser: LocalUser;
  localPreviewDialog: LocalPreviewDialogState;
  localPreviewsByRoom: Record<string, LocalPreviewRecord[]>;
  setLocalPreviewDialog: Dispatch<SetStateAction<LocalPreviewDialogState>>;
  setLocalPreviewBusyForRoom: (roomId: string, busy: boolean) => void;
  setSelectedChatMessage: (message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  publishLocalPreviewEvent: (payload: LocalPreviewRecord, room?: RoomRecord) => Promise<void>;
}

export function useLocalPreviewActions({
  hasSelectedRoom,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  selectedRoom,
  rooms,
  localUser,
  localPreviewDialog,
  localPreviewsByRoom,
  setLocalPreviewDialog,
  setLocalPreviewBusyForRoom,
  setSelectedChatMessage,
  setChatMessageForRoom,
  publishLocalPreviewEvent
}: UseLocalPreviewActionsOptions) {
  async function openLocalPreviewDialog() {
    if (!hasSelectedRoom) return;
    if (isSelectedRoomLocked) {
      setSelectedChatMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    setLocalPreviewBusyForRoom(selectedRoom.id, true);
    setLocalPreviewDialog({
      open: true,
      phase: "select",
      roomId: selectedRoom.id,
      candidates: [],
      selectedUrl: "",
      manualUrl: "",
      error: null,
      cloudflaredVersion: null
    });
    try {
      const detected = await detectLocalPreviewServers();
      const candidates = detected.map((server) => ({
        url: server.url,
        label: localPreviewLabel(server.url)
      }));
      setLocalPreviewDialog((current) => ({
        ...current,
        candidates,
        selectedUrl: candidates[0]?.url ?? "",
        error: candidates.length ? null : "No common local development servers were detected. Enter a local URL manually."
      }));
    } catch (error) {
      setLocalPreviewDialog((current) => ({
        ...current,
        error: `Could not detect local web servers: ${String(error)}`
      }));
    } finally {
      setLocalPreviewBusyForRoom(selectedRoom.id, false);
    }
  }

  async function prepareLocalPreviewConfirmation() {
    const room = rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom;
    const selectedUrl = localPreviewDialog.manualUrl.trim() || localPreviewDialog.selectedUrl;
    try {
      const normalizedUrl = normalizeLocalPreviewUrl(selectedUrl);
      setLocalPreviewDialog((current) => ({ ...current, error: null, selectedUrl: normalizedUrl }));
      const cloudflared = await probeCloudflared();
      if (!cloudflared.available) {
        setLocalPreviewDialog((current) => ({
          ...current,
          phase: "install",
          error: cloudflared.error ?? "cloudflared is not installed.",
          cloudflaredVersion: null
        }));
        return;
      }
      setLocalPreviewDialog((current) => ({
        ...current,
        phase: "confirm",
        roomId: room.id,
        selectedUrl: normalizedUrl,
        cloudflaredVersion: cloudflared.version,
        error: null
      }));
    } catch (error) {
      setLocalPreviewDialog((current) => ({ ...current, error: String(error) }));
    }
  }

  async function confirmLocalPreviewShare() {
    const room = rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom;
    const previewId = crypto.randomUUID();
    const sourceUrl = localPreviewDialog.selectedUrl;
    const now = new Date().toISOString();
    setLocalPreviewDialog((current) => ({ ...current, phase: "starting", error: null }));
    setLocalPreviewBusyForRoom(room.id, true);
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
      setLocalPreviewDialog((current) => ({ ...current, open: false }));
      setChatMessageForRoom(room.id, `Shared local preview: ${tunnel.publicUrl}`);
    } catch (error) {
      const errorPayload: LocalPreviewRecord = {
        ...startingPayload,
        status: "error",
        message: String(error),
        updatedAt: new Date().toISOString()
      };
      await publishLocalPreviewEvent(errorPayload, room);
      setLocalPreviewDialog((current) => ({ ...current, phase: "select", error: String(error) }));
    } finally {
      setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopLocalPreview(previewId: string) {
    const room = selectedRoom;
    const preview = (localPreviewsByRoom[room.id] ?? []).find((item) => item.id === previewId);
    if (!preview) return;
    setLocalPreviewBusyForRoom(room.id, true);
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
      setLocalPreviewBusyForRoom(room.id, false);
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

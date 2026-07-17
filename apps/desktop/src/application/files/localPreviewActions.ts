import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  detectLocalPreviewServers,
  probeCloudflared,
  startLocalPreviewTunnel,
  stopAllLocalPreviewTunnels,
  stopLocalPreviewTunnel
} from "../../lib/platform/localBackend";
import { localPreviewLabel, normalizeLocalPreviewUrl, quickTunnelDisclaimer } from "../../lib/files/localPreview";
import { roomLockMessage } from "../runtime/appRuntime";
import { useAppStore } from "../../store/appStore";
import type { LocalPreviewRecord } from "../../types";
import { currentLocalIdentity } from "../workspace/selectedWorkspace";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

interface LocalPreviewActionsOptions {
  publishLocalPreviewEvent: (payload: LocalPreviewRecord, room?: ClientRoomRecord) => Promise<void>;
}

let localPreviewCleanupGeneration = 0;
const activeLocalPreviewStarts = new Map<string, { payload: LocalPreviewRecord; room: ClientRoomRecord }>();

export function createLocalPreviewActions({ publishLocalPreviewEvent }: LocalPreviewActionsOptions) {
  const selectedRoom = () => {
    const state = useAppStore.getState();
    return state.rooms.find((room) => room.id === state.selectedRoomId);
  };

  async function openLocalPreviewDialog() {
    const room = selectedRoom();
    if (!room) return;
    const { forgottenRoomIds, revokedRoomIds, revokedTeamIds } = useAppStore.getState();
    const isSelectedRoomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const isSelectedRoomLocked = room.archivedAt != null || forgottenRoomIds.has(room.id) || isSelectedRoomRevoked;
    if (isSelectedRoomLocked) {
      useAppStore.getState().setChatMessageForRoom(room.id, roomLockMessage(room, isSelectedRoomRevoked));
      return;
    }
    useAppStore.getState().setLocalPreviewBusyForRoom(room.id, true);
    useAppStore.getState().openLocalPreviewDialogForRoom(room.id);
    try {
      const detected = await detectLocalPreviewServers();
      const candidates = detected.map((server) => ({
        url: server.url,
        label: localPreviewLabel(server.url)
      }));
      useAppStore
        .getState()
        .setLocalPreviewDialogCandidates(
          candidates,
          candidates.length ? null : "No common local development servers were detected. Enter a local URL manually."
        );
    } catch (error) {
      useAppStore.getState().setLocalPreviewDialogError(`Could not detect local web servers: ${String(error)}`);
    } finally {
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function prepareLocalPreviewConfirmation() {
    const { localPreviewDialog } = useAppStore.getState();
    const state = useAppStore.getState();
    const room = state.rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom();
    if (!room) return;
    const selectedUrl = localPreviewDialog.manualUrl.trim() || localPreviewDialog.selectedUrl;
    try {
      const normalizedUrl = normalizeLocalPreviewUrl(selectedUrl);
      useAppStore.getState().setLocalPreviewDialogError(null);
      useAppStore.getState().setLocalPreviewDialogSelectedUrl(normalizedUrl);
      const cloudflared = await probeCloudflared();
      if (!cloudflared.available) {
        useAppStore
          .getState()
          .setLocalPreviewDialogPhase("install", cloudflared.error ?? "cloudflared is not installed.");
        return;
      }
      useAppStore.getState().setLocalPreviewDialogConfirmation(room.id, normalizedUrl, cloudflared.version);
    } catch (error) {
      useAppStore.getState().setLocalPreviewDialogError(String(error));
    }
  }

  async function confirmLocalPreviewShare() {
    const cleanupGeneration = localPreviewCleanupGeneration;
    const { localUser } = currentLocalIdentity();
    const { localPreviewDialog } = useAppStore.getState();
    const state = useAppStore.getState();
    const room = state.rooms.find((item) => item.id === localPreviewDialog.roomId) ?? selectedRoom();
    if (!room) return;
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
    activeLocalPreviewStarts.set(previewId, { payload: startingPayload, room });
    try {
      await publishLocalPreviewEvent(startingPayload, room);
      if (cleanupGeneration !== localPreviewCleanupGeneration) return;
      const tunnel = await startLocalPreviewTunnel(previewId, sourceUrl);
      if (cleanupGeneration !== localPreviewCleanupGeneration) {
        try {
          await stopLocalPreviewTunnel(previewId);
        } catch {
          reportExpectedFailure("cancelled local preview tunnel was already stopped");
        }
        return;
      }
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
      if (cleanupGeneration !== localPreviewCleanupGeneration) return;
      const errorPayload: LocalPreviewRecord = {
        ...startingPayload,
        status: "error",
        message: String(error),
        updatedAt: new Date().toISOString()
      };
      await publishLocalPreviewEvent(errorPayload, room);
      useAppStore.getState().setLocalPreviewDialogPhase("select", String(error));
    } finally {
      activeLocalPreviewStarts.delete(previewId);
      if (cleanupGeneration === localPreviewCleanupGeneration) {
        useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
      }
    }
  }

  async function stopLocalPreview(previewId: string) {
    const room = selectedRoom();
    if (!room) return;
    const preview = (useAppStore.getState().localPreviewByRoom[room.id]?.previews ?? []).find(
      (item) => item.id === previewId
    );
    if (!preview) return;
    useAppStore.getState().setLocalPreviewBusyForRoom(room.id, true);
    try {
      await stopLocalPreviewTunnel(previewId);
      await publishLocalPreviewEvent(
        {
          ...preview,
          status: "stopped",
          message: "This preview is no longer available.",
          updatedAt: new Date().toISOString()
        },
        room
      );
    } catch (error) {
      await publishLocalPreviewEvent(
        {
          ...preview,
          status: "error",
          message: `Tunnel process could not be terminated: ${String(error)}`,
          updatedAt: new Date().toISOString()
        },
        room
      );
    } finally {
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopOwnedLocalPreviews(message = "This preview is no longer available.") {
    localPreviewCleanupGeneration += 1;
    await stopAllLocalPreviewTunnels();
    const { localUser } = currentLocalIdentity();
    const { localPreviewByRoom } = useAppStore.getState();
    const previewsById = new Map<string, { preview: LocalPreviewRecord; room: ClientRoomRecord }>();
    for (const [roomId, runtime] of Object.entries(localPreviewByRoom)) {
      const previews = runtime.previews ?? [];
      const room = useAppStore.getState().rooms.find((item) => item.id === roomId);
      if (!room) continue;
      for (const preview of previews) {
        if (preview.sharedByUserId !== localUser.id || (preview.status !== "live" && preview.status !== "starting"))
          continue;
        previewsById.set(preview.id, { preview, room });
      }
    }
    for (const [previewId, active] of activeLocalPreviewStarts) {
      if (active.payload.sharedByUserId === localUser.id)
        previewsById.set(previewId, { preview: active.payload, room: active.room });
    }
    for (const { preview, room } of previewsById.values()) {
      await publishLocalPreviewEvent(
        {
          ...preview,
          status: "stopped",
          message,
          updatedAt: new Date().toISOString()
        },
        room
      );
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

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
import type { LocalPreviewStartResult } from "../../lib/platform/localBackend";

interface LocalPreviewActionsOptions {
  publishLocalPreviewEvent: (payload: LocalPreviewRecord, room?: ClientRoomRecord) => Promise<void>;
}

// Action factories are recreated during React renders; cancellation must outlive any one factory instance.
const cancelledLocalPreviewIds = new Set<string>();
const pendingLocalPreviewStarts = new Map<string, Promise<LocalPreviewStartResult>>();
const localPreviewCancellationConfirmations = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }
>();

function cancellationConfirmation(previewId: string) {
  const existing = localPreviewCancellationConfirmations.get(previewId);
  if (existing) return existing;
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => undefined);
  const confirmation = { promise, resolve, reject };
  localPreviewCancellationConfirmations.set(previewId, confirmation);
  return confirmation;
}

function cancelLocalPreviewStart(previewId: string) {
  cancelledLocalPreviewIds.add(previewId);
  return cancellationConfirmation(previewId);
}

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
    let tunnelStarted = false;
    try {
      await publishLocalPreviewEvent(startingPayload, room);
      if (cancelledLocalPreviewIds.has(previewId)) {
        await cancellationConfirmation(previewId).promise;
        return;
      }
      const start = startLocalPreviewTunnel(previewId, sourceUrl);
      pendingLocalPreviewStarts.set(previewId, start);
      let tunnel: LocalPreviewStartResult;
      try {
        tunnel = await start;
      } finally {
        if (pendingLocalPreviewStarts.get(previewId) === start) pendingLocalPreviewStarts.delete(previewId);
      }
      tunnelStarted = true;
      if (cancelledLocalPreviewIds.has(previewId)) {
        await cancellationConfirmation(previewId).promise;
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
      if (cancelledLocalPreviewIds.has(previewId)) {
        await cancellationConfirmation(previewId).promise;
        return;
      }
      let cleanupError: unknown;
      if (tunnelStarted) {
        try {
          await stopLocalPreviewTunnel(previewId);
        } catch (stopError) {
          cleanupError = stopError;
        }
      }
      const errorPayload: LocalPreviewRecord = {
        ...startingPayload,
        status: "error",
        message:
          cleanupError === undefined
            ? String(error)
            : `${String(error)} The public tunnel also could not be confirmed stopped: ${String(cleanupError)}`,
        updatedAt: new Date().toISOString()
      };
      useAppStore.getState().setLocalPreviewDialogPhase("select", String(error));
      if (cleanupError === undefined) {
        await publishLocalPreviewEvent(errorPayload, room);
      } else {
        try {
          await publishLocalPreviewEvent(errorPayload, room);
        } catch (publishError) {
          throw new AggregateError(
            [cleanupError, publishError],
            "The public tunnel could not be confirmed stopped and its error status could not be published."
          );
        }
        throw cleanupError;
      }
    } finally {
      cancelledLocalPreviewIds.delete(previewId);
      localPreviewCancellationConfirmations.delete(previewId);
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopLocalPreview(previewId: string) {
    const room = selectedRoom();
    if (!room) return;
    const preview = (useAppStore.getState().localPreviewByRoom[room.id]?.previews ?? []).find(
      (item) => item.id === previewId
    );
    if (!preview) return;
    const cancellation = preview.status === "starting" ? cancelLocalPreviewStart(previewId) : null;
    useAppStore.getState().setLocalPreviewBusyForRoom(room.id, true);
    try {
      const pendingStart = pendingLocalPreviewStarts.get(previewId);
      if (pendingStart) await Promise.allSettled([pendingStart]);
      await stopLocalPreviewTunnel(previewId);
      cancellation?.resolve();
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
      cancellation?.reject(error);
      await publishLocalPreviewEvent(
        {
          ...preview,
          status: "error",
          message: `Tunnel process could not be terminated: ${String(error)}`,
          updatedAt: new Date().toISOString()
        },
        room
      );
      if (cancellation) throw error;
    } finally {
      if (preview.status === "live") cancelledLocalPreviewIds.delete(previewId);
      useAppStore.getState().setLocalPreviewBusyForRoom(room.id, false);
    }
  }

  async function stopOwnedLocalPreviews(message = "This preview is no longer available.") {
    const { localUser } = currentLocalIdentity();
    const { localPreviewByRoom } = useAppStore.getState();
    const ownedPreviews: Array<{ preview: LocalPreviewRecord; room: ClientRoomRecord }> = [];
    for (const [roomId, runtime] of Object.entries(localPreviewByRoom)) {
      const previews = runtime.previews ?? [];
      const room = useAppStore.getState().rooms.find((item) => item.id === roomId);
      if (!room) continue;
      for (const preview of previews) {
        if (preview.sharedByUserId !== localUser.id || (preview.status !== "live" && preview.status !== "starting"))
          continue;
        cancelLocalPreviewStart(preview.id);
        ownedPreviews.push({ preview, room });
      }
    }
    for (const previewId of pendingLocalPreviewStarts.keys()) cancelLocalPreviewStart(previewId);
    const cancelledIds = [...cancelledLocalPreviewIds];
    await Promise.allSettled(
      cancelledIds.flatMap((previewId) => {
        const pending = pendingLocalPreviewStarts.get(previewId);
        return pending ? [pending] : [];
      })
    );
    try {
      await stopAllLocalPreviewTunnels();
      for (const previewId of cancelledIds) cancellationConfirmation(previewId).resolve();
    } catch (error) {
      for (const previewId of cancelledIds) cancellationConfirmation(previewId).reject(error);
      for (const { preview, room } of ownedPreviews) {
        await publishLocalPreviewEvent(
          {
            ...preview,
            status: "error",
            message: `Tunnel process could not be confirmed stopped: ${String(error)}`,
            updatedAt: new Date().toISOString()
          },
          room
        );
      }
      throw error;
    }
    for (const { preview, room } of ownedPreviews) {
      await publishLocalPreviewEvent(
        {
          ...preview,
          status: "stopped",
          message,
          updatedAt: new Date().toISOString()
        },
        room
      );
      if (preview.status === "live") cancelledLocalPreviewIds.delete(preview.id);
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

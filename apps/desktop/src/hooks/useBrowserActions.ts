import type { MutableRefObject } from "react";
import type { BrowserRequestPlaintextPayload, RelayEnvelope, RoomRecord } from "@multaiplayer/protocol";
import { encryptJson } from "@multaiplayer/crypto";
import { resetBrowserProfile } from "../lib/localBackend";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import type { RelayClient } from "../lib/relayClient";
import {
  canActOnRoomBrowserRequest,
  findRoomBrowserRequest,
  roomBrowserRequestMessage
} from "../lib/browserPolicy";
import { formatBrowserAccessLabel, normalizeBrowserLocationInput } from "../lib/browserUi";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import type { BrowserAccessRequest } from "../types";
import { useAppStore } from "../store/appStore";

interface LocalUser {
  id: string;
  name: string;
}

interface UseBrowserActionsOptions {
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  canRequestBrowser: boolean;
  canHostBrowser: boolean;
  browserAccessMessage: string;
  hostGateMessage: string;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  browserUrl: string;
  browserReason: string;
  browserRequests: BrowserAccessRequest[];
  localUser: LocalUser;
  deviceId: string;
  relayStatus: "connecting" | "open" | "closed" | "error";
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  setSelectedBrowserMessage: (message: string | null) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  setBrowserUrlForRoom: (roomId: string, url: string) => void;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  publishRequestStatus: (
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: "approved" | "denied",
    room?: RoomRecord
  ) => Promise<void>;
}

export function useBrowserActions({
  hasSelectedRoom,
  isActiveHost,
  canRequestBrowser,
  canHostBrowser,
  browserAccessMessage,
  hostGateMessage,
  selectedRoom,
  selectedRoomIdRef,
  browserUrl,
  browserReason,
  browserRequests,
  localUser,
  deviceId,
  relayStatus,
  relayRef,
  seenEnvelopeIds,
  setSelectedBrowserMessage,
  setBrowserMessageForRoom,
  setBrowserUrlForRoom,
  appendBrowserRequest,
  updateBrowserRequestStatus,
  publishRequestStatus
}: UseBrowserActionsOptions) {
  const openEmbeddedBrowserForRoom = useAppStore((state) => state.openEmbeddedBrowserForRoom);
  const resetEmbeddedBrowserForRoom = useAppStore((state) => state.resetEmbeddedBrowserForRoom);
  const setInspectorTabForRoom = useAppStore((state) => state.setInspectorTabForRoom);

  async function requestBrowserAccess() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before requesting browser access.");
      return;
    }
    const room = selectedRoom;
    if (!canRequestBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = room.id;
    const rawUrl = browserUrl.trim();
    if (!rawUrl) return;
    setBrowserMessageForRoom(roomId, null);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      setBrowserMessageForRoom(roomId, "Enter a valid browser URL.");
      return;
    }

    const request: BrowserAccessRequest = {
      id: crypto.randomUUID(),
      requester: localUser.name,
      requesterUserId: localUser.id,
      url: parsedUrl.toString(),
      reason: browserReason.trim() || "No reason provided.",
      requestedAt: new Date().toISOString(),
      status: "pending"
    };

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendBrowserRequest(room.id, request);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          "Saved browser request locally because the relay is not connected."
        );
      }
      return;
    }

    try {
      const payload: BrowserRequestPlaintextPayload = {
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        url: request.url,
        reason: request.reason,
        requestedAt: request.requestedAt
      };
      const secret = await loadOrCreateRoomSecret(room.id);
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "browser.request",
        payload: await encryptJson(payload, secret)
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
      appendBrowserRequest(room.id, request);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          `Requested browser access to ${formatBrowserAccessLabel(request.url)}.`
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setBrowserMessageForRoom(roomId, String(error));
    }
  }

  function approveBrowserRequest(request: BrowserAccessRequest) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before approving browser access.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "pending")) {
      setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, request.id, "pending"));
      return;
    }
    updateBrowserRequestStatus(roomId, roomRequest.id, "approved");
    publishRequestStatus("browser.event", roomRequest.id, "approved").catch((error) => {
      setBrowserMessageForRoom(roomId, String(error));
    });
    setBrowserMessageForRoom(roomId, `Approved browser access to ${formatBrowserAccessLabel(roomRequest.url)}.`);
  }

  function denyBrowserRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before denying browser access.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (!canActOnRoomBrowserRequest(browserRequests, requestId, "pending")) {
      setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, requestId, "pending"));
      return;
    }
    updateBrowserRequestStatus(roomId, requestId, "denied");
    publishRequestStatus("browser.event", requestId, "denied").catch((error) => {
      setBrowserMessageForRoom(roomId, String(error));
    });
    setBrowserMessageForRoom(roomId, "Denied browser access request.");
  }

  async function openApprovedBrowserRequest(request: BrowserAccessRequest) {
    if (request.status !== "approved") return;
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const room = selectedRoom;
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "approved")) {
      setBrowserMessageForRoom(room.id, roomBrowserRequestMessage(browserRequests, request.id, "approved"));
      return;
    }
    setBrowserMessageForRoom(room.id, null);
    openEmbeddedRoomBrowser(room, roomRequest.url);
  }

  async function openRoomBrowserNow() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const room = selectedRoom;
    const rawUrl = browserUrl.trim();
    if (!rawUrl) {
      setBrowserMessageForRoom(room.id, "Enter a URL to open in the room browser.");
      return;
    }
    const nextUrl = normalizeBrowserLocationInput(rawUrl);
    if (!nextUrl) {
      setBrowserMessageForRoom(room.id, "Enter a valid URL or search.");
      return;
    }
    openRoomBrowserForUrl(room, nextUrl, "Opened by the active host.");
  }

  function openRoomBrowserForUrl(room: RoomRecord, url: string, reason: string) {
    const request: BrowserAccessRequest = {
      id: crypto.randomUUID(),
      requester: localUser.name,
      requesterUserId: localUser.id,
      url,
      reason,
      requestedAt: new Date().toISOString(),
      status: "approved"
    };
    appendBrowserRequest(room.id, request);
    setBrowserMessageForRoom(room.id, null);
    setBrowserUrlForRoom(room.id, request.url);
    openEmbeddedRoomBrowser(room, request.url);
  }

  function openEmbeddedRoomBrowser(room: RoomRecord, url: string) {
    openEmbeddedBrowserForRoom(room.id, url);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
      setBrowserMessageForRoom(room.id, `Opened in-room browser for ${formatBrowserAccessLabel(url)}.`);
      setInspectorTabForRoom(room.id, "browser");
    }
  }

  async function resetRoomBrowserProfile() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before resetting browser state.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const room = selectedRoom;
    setBrowserMessageForRoom(room.id, null);
    try {
      const result = await resetBrowserProfile(room.id, room.projectPath);
      resetEmbeddedBrowserForRoom(room.id, result.profilePath);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setBrowserMessageForRoom(room.id, "Reset isolated room browser state. The next approved page opens with a fresh profile.");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setBrowserMessageForRoom(room.id, String(error));
    }
  }

  return {
    requestBrowserAccess,
    approveBrowserRequest,
    denyBrowserRequest,
    openApprovedBrowserRequest,
    openRoomBrowserNow,
    openRoomBrowserForUrl,
    resetRoomBrowserProfile
  };
}

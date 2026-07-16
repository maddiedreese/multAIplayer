import type { MutableRefObject } from "react";
import type { BrowserRequestPlaintextPayload, MlsRelayMessage, ClientRoomRecord } from "@multaiplayer/protocol";
import type { RelayClient } from "../../lib/relay/relayClient";
import {
  canActOnRoomBrowserRequest,
  findRoomBrowserRequest,
  roomBrowserRequestMessage
} from "../../lib/browser/browserPolicy";
import { formatBrowserAccessLabel, normalizeBrowserLocationInput } from "../../lib/browser/browserUi";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import type { BrowserAccessRequest } from "../../types";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "../mls/mlsApplicationMessage";
import { useAppStore } from "../../store/appStore";
import { currentSelectedRoom, currentSelectedRoomContext } from "../workspace/selectedWorkspace";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

interface BrowserActionsOptions {
  selectedRoomIdRef: MutableRefObject<string | null>;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  publishRequestStatus: (
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: "approved" | "denied",
    room?: ClientRoomRecord
  ) => Promise<void>;
}

export function createBrowserActions({
  selectedRoomIdRef,
  defaultBrowserUrl,
  defaultBrowserReason,
  relayRef,
  seenEnvelopeIds,
  publishRequestStatus
}: BrowserActionsOptions) {
  const currentContext = () => currentSelectedRoomContext();
  const setSelectedBrowserMessage = (message: string | null) => {
    const roomId = useAppStore.getState().selectedRoomId;
    if (roomId) useAppStore.getState().setBrowserMessageForRoom(roomId, message);
  };

  function browserRequestsForRoom(roomId: string) {
    return useAppStore.getState().browserByRoom[roomId]?.requests ?? [];
  }

  async function requestBrowserAccess() {
    const requestContext = createBrowserRequestContext();
    if (!requestContext) return;
    const { room, request } = requestContext;
    const roomId = room.id;
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      saveLocalBrowserRequest(roomId, request);
      return null;
    }

    await publishBrowserRequest(client, room, request);
  }

  function createBrowserRequestContext(): { room: ClientRoomRecord; request: BrowserAccessRequest } | null {
    const room = currentSelectedRoom();
    if (!room) {
      setSelectedBrowserMessage("Create or join a room before requesting browser access.");
      return null;
    }
    if (!currentContext()?.canRequestBrowser) {
      setSelectedBrowserMessage(currentContext()?.browserAccessMessage ?? "Browser access is unavailable.");
      return null;
    }
    const roomId = room.id;
    const roomBrowser = useAppStore.getState().browserByRoom[roomId];
    const rawUrl = (roomBrowser?.url ?? defaultBrowserUrl).trim();
    if (!rawUrl) return null;
    useAppStore.getState().setBrowserMessageForRoom(roomId, null);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      reportExpectedFailure("browser request URL validation rejected malformed input");
      useAppStore.getState().setBrowserMessageForRoom(roomId, "Enter a valid browser URL.");
      return null;
    }

    return {
      room,
      request: {
        id: crypto.randomUUID(),
        requester: currentContext()?.localUser.name ?? "Local user",
        requesterUserId: currentContext()?.localUser.id ?? "local",
        url: parsedUrl.toString(),
        reason: (roomBrowser?.reason ?? defaultBrowserReason).trim() || "No reason provided.",
        requestedAt: new Date().toISOString(),
        status: "pending"
      }
    };
  }

  function saveLocalBrowserRequest(roomId: string, request: BrowserAccessRequest) {
    useAppStore.getState().appendBrowserRequest(roomId, request);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      useAppStore
        .getState()
        .setBrowserMessageForRoom(roomId, "Saved browser request locally because the relay is not connected.");
    }
  }

  async function publishBrowserRequest(client: RelayClient, room: ClientRoomRecord, request: BrowserAccessRequest) {
    const roomId = room.id;
    try {
      const payload: BrowserRequestPlaintextPayload = {
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        url: request.url,
        reason: request.reason,
        requestedAt: request.requestedAt
      };
      const envelope: MlsRelayMessage = await createMlsApplicationMessage(
        {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: currentContext()?.deviceId ?? "local-device",
          senderUserId: currentContext()?.localUser.id ?? "local",
          createdAt: new Date().toISOString(),
          kind: "browser.request"
        },
        payload
      );
      seenEnvelopeIds.current.add(envelope.id);
      await publishMlsApplicationMessage(client, envelope);
      useAppStore.getState().appendBrowserRequest(roomId, request);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        useAppStore
          .getState()
          .setBrowserMessageForRoom(roomId, `Requested browser access to ${formatBrowserAccessLabel(request.url)}.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        useAppStore.getState().setBrowserMessageForRoom(roomId, String(error));
      }
    }
  }

  function approveBrowserRequest(request: BrowserAccessRequest) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedBrowserMessage("Create or join a room before approving browser access.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedBrowserMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    if (!currentContext()?.canHostBrowser) {
      setSelectedBrowserMessage(currentContext()?.browserAccessMessage ?? "Browser access is unavailable.");
      return;
    }
    const roomId = selectedRoom.id;
    const browserRequests = browserRequestsForRoom(roomId);
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "pending")) {
      useAppStore
        .getState()
        .setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, request.id, "pending"));
      return;
    }
    useAppStore.getState().updateBrowserRequestStatus(roomId, roomRequest.id, "approved");
    publishRequestStatus("browser.event", roomRequest.id, "approved").catch((error) => {
      useAppStore.getState().setBrowserMessageForRoom(roomId, String(error));
    });
    useAppStore
      .getState()
      .setBrowserMessageForRoom(roomId, `Approved browser access to ${formatBrowserAccessLabel(roomRequest.url)}.`);
  }

  function denyBrowserRequest(requestId: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedBrowserMessage("Create or join a room before denying browser access.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedBrowserMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    if (!currentContext()?.canHostBrowser) {
      setSelectedBrowserMessage(currentContext()?.browserAccessMessage ?? "Browser access is unavailable.");
      return;
    }
    const roomId = selectedRoom.id;
    const browserRequests = browserRequestsForRoom(roomId);
    if (!canActOnRoomBrowserRequest(browserRequests, requestId, "pending")) {
      useAppStore
        .getState()
        .setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, requestId, "pending"));
      return;
    }
    useAppStore.getState().updateBrowserRequestStatus(roomId, requestId, "denied");
    publishRequestStatus("browser.event", requestId, "denied").catch((error) => {
      useAppStore.getState().setBrowserMessageForRoom(roomId, String(error));
    });
    useAppStore.getState().setBrowserMessageForRoom(roomId, "Denied browser access request.");
  }

  async function openApprovedBrowserRequest(request: BrowserAccessRequest) {
    if (request.status !== "approved") return;
    const room = currentSelectedRoom();
    if (!room) {
      setSelectedBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedBrowserMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    if (!currentContext()?.canHostBrowser) {
      setSelectedBrowserMessage(currentContext()?.browserAccessMessage ?? "Browser access is unavailable.");
      return;
    }
    const browserRequests = browserRequestsForRoom(room.id);
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "approved")) {
      useAppStore
        .getState()
        .setBrowserMessageForRoom(room.id, roomBrowserRequestMessage(browserRequests, request.id, "approved"));
      return;
    }
    useAppStore.getState().setBrowserMessageForRoom(room.id, null);
    openEmbeddedRoomBrowser(room, roomRequest.url);
  }

  async function openRoomBrowserNow() {
    const room = currentSelectedRoom();
    if (!room) {
      setSelectedBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedBrowserMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    if (!currentContext()?.canHostBrowser) {
      setSelectedBrowserMessage(currentContext()?.browserAccessMessage ?? "Browser access is unavailable.");
      return;
    }
    const rawUrl = (useAppStore.getState().browserByRoom[room.id]?.url ?? defaultBrowserUrl).trim();
    if (!rawUrl) {
      useAppStore.getState().setBrowserMessageForRoom(room.id, "Enter a URL to open in the room browser.");
      return;
    }
    const nextUrl = normalizeBrowserLocationInput(rawUrl);
    if (!nextUrl) {
      useAppStore.getState().setBrowserMessageForRoom(room.id, "Enter a valid URL or search.");
      return;
    }
    openRoomBrowserForUrl(room, nextUrl, "Opened by the active host.");
  }

  function openRoomBrowserForUrl(room: ClientRoomRecord, url: string, reason: string) {
    const request: BrowserAccessRequest = {
      id: crypto.randomUUID(),
      requester: currentContext()?.localUser.name ?? "Local user",
      requesterUserId: currentContext()?.localUser.id ?? "local",
      url,
      reason,
      requestedAt: new Date().toISOString(),
      status: "approved"
    };
    const store = useAppStore.getState();
    store.appendBrowserRequest(room.id, request);
    store.setBrowserMessageForRoom(room.id, null);
    store.setBrowserUrlForRoom(room.id, request.url, defaultBrowserUrl);
    openEmbeddedRoomBrowser(room, request.url);
  }

  function openEmbeddedRoomBrowser(room: ClientRoomRecord, url: string) {
    const store = useAppStore.getState();
    store.openEmbeddedBrowserForRoom(room.id, url);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
      store.setBrowserMessageForRoom(room.id, `Opened in-room browser for ${formatBrowserAccessLabel(url)}.`);
      store.setInspectorTabForRoom(room.id, "browser");
    }
  }

  return {
    requestBrowserAccess,
    approveBrowserRequest,
    denyBrowserRequest,
    openApprovedBrowserRequest,
    openRoomBrowserNow,
    openRoomBrowserForUrl
  };
}

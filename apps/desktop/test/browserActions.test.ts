import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { createBrowserActions } from "../src/lib/browserActions";
import { useAppStore } from "../src/store/appStore";
import type { BrowserAccessRequest } from "../src/types";

const defaultBrowserUrl = "https://example.com/default";
const defaultBrowserReason = "Default browser reason.";

const room: ClientRoomRecord = {
  id: "room-browser-actions",
  teamId: "team-browser-actions",
  name: "Browser Actions",
  projectPath: "/tmp/browser-actions",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

function createOptions(
  overrides: Partial<Parameters<typeof createBrowserActions>[0]> = {}
): Parameters<typeof createBrowserActions>[0] {
  return {
    hasSelectedRoom: true,
    isActiveHost: true,
    canRequestBrowser: true,
    canHostBrowser: true,
    browserAccessMessage: "Browser access is unavailable.",
    hostGateMessage: "Only the active host can control the browser.",
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    defaultBrowserUrl,
    defaultBrowserReason,
    localUser: { id: "github:maddie", name: "Maddie" },
    deviceId: "device-browser-actions",
    relayStatus: "closed",
    relayRef: { current: null },
    seenEnvelopeIds: { current: new Set<string>() },
    publishRequestStatus: async () => undefined,
    ...overrides
  };
}

function pendingRequest(id = "browser-request"): BrowserAccessRequest {
  return {
    id,
    requester: "Alex",
    requesterUserId: "github:alex",
    url: "https://example.com/requested",
    reason: "Review this page.",
    requestedAt: "2026-07-09T12:00:00.000Z",
    status: "pending"
  };
}

test.beforeEach(() => {
  const store = useAppStore.getState();
  store.resetAppStore();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
  store.replaceCurrentUser({ id: "github:maddie", login: "maddie", name: "Maddie" });
});

test("browser actions read the current room URL when invoked", async () => {
  const actions = createBrowserActions(createOptions());
  useAppStore.getState().setBrowserUrlForRoom(room.id, "docs.example.com/current", defaultBrowserUrl);

  await actions.openRoomBrowserNow();

  const roomBrowser = useAppStore.getState().browserByRoom[room.id];
  assert.equal(roomBrowser?.requests?.[0]?.url, "http://docs.example.com/current");
  assert.equal(roomBrowser?.activeUrl, "http://docs.example.com/current");
});

test("browser actions approve requests added after action creation", () => {
  const published: Array<{ requestId: string; status: string }> = [];
  const actions = createBrowserActions(
    createOptions({
      publishRequestStatus: async (_kind, requestId, status) => {
        published.push({ requestId, status });
      }
    })
  );
  const request = pendingRequest();
  useAppStore.getState().appendBrowserRequest(room.id, request);

  actions.approveBrowserRequest(request);

  assert.equal(useAppStore.getState().browserByRoom[room.id]?.requests?.[0]?.status, "approved");
  assert.deepEqual(published, [{ requestId: request.id, status: "approved" }]);
});

test("disconnected browser requests use the current store draft", async () => {
  const actions = createBrowserActions(createOptions());
  useAppStore.getState().setBrowserUrlForRoom(room.id, "https://example.com/from-store", defaultBrowserUrl);
  useAppStore.getState().setBrowserReasonForRoom(room.id, "Current reason", defaultBrowserReason);

  await actions.requestBrowserAccess();

  const request = useAppStore.getState().browserByRoom[room.id]?.requests?.[0];
  assert.equal(request?.url, "https://example.com/from-store");
  assert.equal(request?.reason, "Current reason");
  assert.match(useAppStore.getState().browserByRoom[room.id]?.message ?? "", /saved.*locally/i);
});

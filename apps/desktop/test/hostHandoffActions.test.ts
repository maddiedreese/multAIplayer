import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { useHostHandoffActions } from "../src/hooks/useHostHandoffActions";
import type { UseHostHandoffActionsOptions } from "../src/application/handoff/hostHandoffActionTypes";
import { useAppStore } from "../src/store/appStore";
import type { HostHandoffRecord } from "../src/types";
import { RelayPublishRejectedError } from "../src/lib/relay/relayClient";
import { establishDeviceSession } from "../src/lib/identity/deviceSession";
import { getRelayHttpUrl } from "../src/lib/core/appConfig";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });

let nativeCommands: string[] = [];
let onNativeCommand: ((command: string) => void) | null = null;
const tauriInternals = {
  invoke: async (command: string, args?: { request?: Record<string, unknown> }) => {
    nativeCommands.push(command);
    onNativeCommand?.(command);
    if (command === "mls_group_state") {
      return {
        roster: [
          { leaf: 0, githubUserId: "github:host", deviceId: "device-host" },
          { leaf: 1, githubUserId: "github:candidate", deviceId: "device-candidate" }
        ],
        selfLeaf: 1,
        epoch: 2
      };
    }
    if (command === "mls_encrypt_application") {
      const request = args?.request ?? {};
      const authenticatedData = request.authenticatedData as Record<string, unknown>;
      return {
        message: "AA==",
        outboxId: request.messageId,
        epoch: 2,
        authenticatedData: JSON.stringify({
          version: authenticatedData.version,
          epoch: 2,
          messageId: authenticatedData.messageId,
          teamId: authenticatedData.teamId,
          roomId: authenticatedData.roomId,
          kind: authenticatedData.kind,
          senderUserId: authenticatedData.senderUserId,
          senderDeviceId: authenticatedData.senderDeviceId,
          createdAt: authenticatedData.createdAt
        })
      };
    }
    if (command === "mls_publish_succeeded") return 2;
    if (command === "mls_device_auth_sign") return { signatureDer: "signature", publicKeySpkiDer: "public-key" };
    if (command === "mls_clear_pending_commit") return 2;
    if (command === "mls_current_epoch") return 3;
    if (command === "mls_transfer_host") return { message: "commit", outboxId: "commit-1", parentEpoch: 2 };
    if (command === "mls_host_transfer_authorization") {
      return {
        authorization: {
          version: 1,
          roomId: room.id,
          transferId: offer.id,
          commitMessageId: "commit-1",
          parentEpoch: 2,
          outgoingHostUserId: "github:host",
          outgoingHostDeviceId: "device-host",
          nextHostUserId: "github:candidate",
          nextHostDeviceId: "device-candidate",
          nextHostLeaf: 1
        },
        signatureDer: "signature",
        publicKeySpkiDer: "public-key"
      };
    }
    if (command === "git_apply_patch") return { command: "git apply", status: 0, stdout: "", stderr: "" };
    if (command === "plugin:dialog|open") return "/tmp";
    if (command === "git_clone_repository") {
      return {
        path: "/tmp/locally-cloned-project",
        command: "git clone https://github.com/example/project.git /tmp/locally-cloned-project",
        status: 0,
        stdout: "",
        stderr: ""
      };
    }
    if (command === "git_remote_origin") return { originUrl: "https://github.com/example/project.git" };
    throw new Error(`Unexpected native command: ${command}`);
  }
};
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", { configurable: true, value: tauriInternals });
Object.defineProperty(dom.window, "__TAURI_INTERNALS__", { configurable: true, value: tauriInternals });

const room: ClientRoomRecord = {
  id: "room-handoff",
  teamId: "team-handoff",
  name: "Handoff",
  projectPath: "/tmp/project",
  host: "Host",
  hostUserId: "github:host",
  activeHostDeviceId: "device-host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.5",
  browserProfilePersistent: true,
  unread: 0
};

const offer: HostHandoffRecord = {
  id: "offer-1",
  fromHost: "Host",
  fromUserId: "github:host",
  reason: "manual",
  projectPath: room.projectPath,
  gitRemoteUrl: "https://github.com/example/project.git",
  gitRepoOwner: "example",
  gitRepoName: "project",
  gitBranch: "main",
  codexModel: room.codexModel,
  approvalPolicy: room.approvalPolicy,
  messagesSinceLastCodex: 0,
  attachmentNames: [],
  terminals: [],
  createdAt: "2026-07-13T12:00:00.000Z",
  status: "available"
};

const noop = () => undefined;

function options(publish: () => Promise<void>, seen = new Set<string>()): UseHostHandoffActionsOptions {
  return {
    hasSelectedRoom: true,
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    isSelectedRoomLocked: false,
    isSelectedRoomRevoked: false,
    isActiveHost: false,
    hostGateMessage: "Only the active host can approve.",
    hostHandoffs: [offer],
    queuedCodexTurns: [],
    localUser: { id: "github:candidate", name: "Candidate" },
    deviceId: "device-candidate",
    relayStatus: "open",
    relayRef: {
      current: {
        publish: noop,
        publishAndWaitForAck: async () => publish(),
        joinAndWaitForAck: async () => undefined,
        close: noop
      }
    },
    seenEnvelopeIds: { current: seen },
    messages: [],
    terminals: [],
    browserRequests: [],
    gitStatus: null,
    reportRoomHostMutationInFlight: () => false,
    roomSettingsActor: () => ({ requesterName: "Candidate", requesterUserId: "github:candidate" }),
    replaceRoom: noop,
    setHostBusyForRoom: noop,
    setHostMessageForRoom: useAppStore.getState().setHostMessageForRoom,
    setSelectedHostMessage: noop,
    setSettingsMessageForRoom: noop,
    setProjectPathDraftForRoom: noop,
    setCustomCodexModelForRoom: noop,
    resetFileContextForRoom: noop,
    resetCodexApprovalForRoom: noop,
    appendHostHandoff: noop,
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room,
      isActiveHost: false,
      hostHandoffs: useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs ?? []
    })
  };
}

beforeEach(() => {
  cleanup();
  nativeCommands = [];
  onNativeCommand = null;
  useAppStore.getState().resetAppStore();
  useAppStore.getState().appendHostHandoff(room.id, offer);
});

test("candidate records its authenticated host request only after relay acknowledgement", async () => {
  const { result } = renderHook(() => useHostHandoffActions(options(async () => undefined)));

  await act(() => result.current.acceptHostHandoff(offer));

  const stored = useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs?.[0];
  assert.equal(
    stored?.status,
    "requested",
    useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "host request did not complete"
  );
  assert.equal(stored?.candidateUserId, "github:candidate");
  assert.equal(stored?.candidateDeviceId, "device-candidate");
  assert.equal(stored?.candidateLeaf, 1);
  assert.equal(nativeCommands.includes("plugin:dialog|open"), false);
});

test("failed host requests remain retryable and are not self-suppressed", async () => {
  const seen = new Set<string>();
  const { result } = renderHook(() =>
    useHostHandoffActions(
      options(async () => {
        throw new Error("relay rejected request");
      }, seen)
    )
  );

  await act(() => result.current.acceptHostHandoff(offer));

  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs?.[0]?.status, "available");
  assert.equal(seen.size, 0);
});

test("active host publishes an authenticated transfer commit before accepting the candidate", async () => {
  const requested = {
    ...offer,
    status: "requested" as const,
    candidateUserId: "github:candidate",
    candidateDeviceId: "device-candidate",
    candidateLeaf: 1
  };
  useAppStore.getState().resetAppStore();
  useAppStore.getState().appendHostHandoff(room.id, requested);
  const activeRoom = { ...room, hostStatus: "active" as const };
  const input = {
    ...options(async () => undefined),
    selectedRoom: activeRoom,
    isActiveHost: true,
    localUser: { id: "github:host", name: "Host" },
    deviceId: "device-host",
    hostHandoffs: [requested],
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room: activeRoom,
      isActiveHost: true,
      hostHandoffs: useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs ?? []
    })
  };
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.acceptHostHandoff(requested));

  const transferIndex = nativeCommands.indexOf("mls_transfer_host");
  const authorizationIndex = nativeCommands.indexOf("mls_host_transfer_authorization");
  const persistedIndex = nativeCommands.indexOf("mls_publish_succeeded");
  assert.ok(transferIndex >= 0 && transferIndex < authorizationIndex && authorizationIndex < persistedIndex);
  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs?.[0]?.status, "accepted");
});

test("active-host approval stops before MLS mutation when authority changes during roster lookup", async () => {
  const requested = {
    ...offer,
    status: "requested" as const,
    candidateUserId: "github:candidate",
    candidateDeviceId: "device-candidate",
    candidateLeaf: 1
  };
  let active = true;
  onNativeCommand = (command) => {
    if (command === "mls_group_state") active = false;
  };
  const activeRoom = { ...room, hostStatus: "active" as const };
  const input = {
    ...options(async () => undefined),
    selectedRoom: activeRoom,
    isActiveHost: true,
    localUser: { id: "github:host", name: "Host" },
    deviceId: "device-host",
    hostHandoffs: [requested],
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room: activeRoom,
      isActiveHost: active,
      hostHandoffs: [requested]
    })
  };
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.acceptHostHandoff(requested));

  assert.equal(nativeCommands.includes("mls_transfer_host"), false);
  assert.match(useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "", /no longer the active host/);
});

test("stale host-transfer commits are cleared and rebased before remaining retryable", async () => {
  const requested = {
    ...offer,
    status: "requested" as const,
    candidateUserId: "github:candidate",
    candidateDeviceId: "device-candidate",
    candidateLeaf: 1
  };
  useAppStore.setState({ deviceSessionToken: "session-token" });
  let joins = 0;
  const activeRoom = { ...room, hostStatus: "active" as const };
  const input = {
    ...options(async () => {
      throw new RelayPublishRejectedError("stale_epoch", "commit-1", "stale commit");
    }),
    selectedRoom: activeRoom,
    isActiveHost: true,
    localUser: { id: "github:host", name: "Host" },
    deviceId: "device-host",
    hostHandoffs: [requested],
    relayRef: {
      current: {
        publish: noop,
        publishAndWaitForAck: async () => {
          throw new RelayPublishRejectedError("stale_epoch", "commit-1", "stale commit");
        },
        joinAndWaitForAck: async () => {
          joins += 1;
        },
        rejoinForBacklog: async () => {
          joins += 1;
        },
        close: noop
      }
    },
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room: activeRoom,
      isActiveHost: true,
      hostHandoffs: [requested]
    })
  } satisfies UseHostHandoffActionsOptions;
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.acceptHostHandoff(requested));

  assert.equal(nativeCommands.includes("mls_clear_pending_commit"), true);
  assert.equal(nativeCommands.includes("mls_current_epoch"), false);
  assert.equal(joins, 1);
  assert.equal(nativeCommands.includes("mls_publish_succeeded"), false);
});

test("accepted patch is applied only while the fresh room snapshot retains host authority", async () => {
  const accepted = { ...offer, status: "accepted" as const, gitPatch: "diff --git a/a b/a\n" };
  useAppStore.getState().resetAppStore();
  useAppStore.getState().appendHostHandoff(room.id, accepted);
  const activeRoom = { ...room, hostStatus: "active" as const, hostUserId: "github:candidate" };
  let active = true;
  const input = {
    ...options(async () => undefined),
    selectedRoom: activeRoom,
    isActiveHost: true,
    hostHandoffs: [accepted],
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room: activeRoom,
      isActiveHost: active,
      hostHandoffs: useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs ?? []
    })
  };
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.acceptHostHandoff(accepted));
  assert.equal(nativeCommands.includes("git_apply_patch"), true);
  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.hostHandoffs?.[0]?.patchAppliedLocally, true);

  useAppStore.getState().markHostHandoffPatchAppliedForRoom(room.id, accepted.id);
  active = false;
  const retry = { ...accepted, patchAppliedLocally: false };
  await act(() => result.current.acceptHostHandoff(retry));
  assert.equal(nativeCommands.filter((command) => command === "git_apply_patch").length, 1);
});

test("handoff publication records the package and encrypted relay message", async () => {
  let appended: HostHandoffRecord | null = null;
  let publishes = 0;
  const input = {
    ...options(async () => {
      publishes += 1;
    }),
    isActiveHost: true,
    appendHostHandoff: (_roomId: string, handoff: HostHandoffRecord) => {
      appended = handoff;
    },
    getHostHandoffSnapshot: () => ({
      selectedRoomId: room.id,
      room,
      isActiveHost: true,
      hostHandoffs: appended ? [appended] : []
    })
  };
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.publishHostHandoff(room));

  assert.equal(appended?.status, "available");
  assert.equal(nativeCommands.includes("mls_encrypt_application"), true);
  assert.equal(publishes, 1);
});

test("offline handoff publication preserves the package without attempting encryption", async () => {
  let appended: HostHandoffRecord | null = null;
  let hostMessage = "";
  const input = {
    ...options(async () => undefined),
    relayStatus: "closed" as const,
    relayRef: { current: null },
    appendHostHandoff: (_roomId: string, handoff: HostHandoffRecord) => {
      appended = handoff;
    },
    setHostMessageForRoom: (_roomId: string, message: string | null) => {
      hostMessage = message ?? "";
    }
  };
  const { result } = renderHook(() => useHostHandoffActions(input));

  await act(() => result.current.publishHostHandoff(room));

  assert.equal(appended?.status, "available");
  assert.match(hostMessage, /saved locally/);
  assert.equal(nativeCommands.includes("mls_encrypt_application"), false);
});

test("host claim accepts the exact returned authority installed by websocket before HTTP resumes", async () => {
  const originalFetch = globalThis.fetch;
  const activeRoom = {
    ...room,
    hostStatus: "active" as const,
    hostUserId: "github:candidate",
    activeHostDeviceId: "device-candidate",
    acceptedMlsEpoch: 2
  };
  const claimableRoom = { ...room, acceptedMlsEpoch: 2 };
  let currentRoom: ClientRoomRecord = claimableRoom;
  let publishes = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const json = url.endsWith("/challenge")
      ? { challenge: "challenge", expiresAt: "2099-01-01T00:00:00.000Z" }
      : url.endsWith("/session")
        ? { deviceSessionToken: "session-token", expiresAt: "2099-01-01T00:00:00.000Z" }
        : ((currentRoom = activeRoom), { room: activeRoom });
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    localStorage.setItem(
      "multaiplayer:app-config",
      JSON.stringify({ relayHttpUrl: "http://127.0.0.1:8787", relayWsUrl: "ws://127.0.0.1:8787" })
    );
    await establishDeviceSession(getRelayHttpUrl(), "device-candidate");
    const input = {
      ...options(async () => {
        publishes += 1;
      }),
      selectedRoom: claimableRoom,
      replaceRoom: (next: ClientRoomRecord) => {
        currentRoom = next;
      },
      getHostHandoffSnapshot: () => ({
        selectedRoomId: room.id,
        room: currentRoom,
        isActiveHost: currentRoom.hostUserId === "github:candidate" && currentRoom.hostStatus === "active",
        hostHandoffs: []
      })
    };
    const { result } = renderHook(() => useHostHandoffActions(input));

    await act(() => result.current.setRoomHost("active"));

    assert.equal(currentRoom.hostStatus, "active");
    assert.equal(nativeCommands.includes("mls_encrypt_application"), true);
    assert.equal(publishes, 1);
  } finally {
    localStorage.removeItem("multaiplayer:app-config");
    globalThis.fetch = originalFetch;
  }
});

test("host claim rejects a third-party websocket authority state before config publication", async () => {
  const originalFetch = globalThis.fetch;
  const claimableRoom = { ...room, acceptedMlsEpoch: 2 };
  const returnedRoom = {
    ...claimableRoom,
    hostStatus: "active" as const,
    hostUserId: "github:candidate",
    activeHostDeviceId: "device-candidate"
  };
  const thirdPartyRoom = {
    ...claimableRoom,
    hostStatus: "active" as const,
    hostUserId: "github:other-host",
    activeHostDeviceId: "device-other"
  };
  let currentRoom: ClientRoomRecord = claimableRoom;
  let publishes = 0;
  let hostMessage = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    const json = url.endsWith("/challenge")
      ? { challenge: "challenge", expiresAt: "2099-01-01T00:00:00.000Z" }
      : url.endsWith("/session")
        ? { deviceSessionToken: "session-token", expiresAt: "2099-01-01T00:00:00.000Z" }
        : ((currentRoom = thirdPartyRoom), { room: returnedRoom });
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    localStorage.setItem(
      "multaiplayer:app-config",
      JSON.stringify({ relayHttpUrl: "http://127.0.0.1:8787", relayWsUrl: "ws://127.0.0.1:8787" })
    );
    await establishDeviceSession(getRelayHttpUrl(), "device-candidate");
    const input = {
      ...options(async () => {
        publishes += 1;
      }),
      selectedRoom: claimableRoom,
      replaceRoom: (next: ClientRoomRecord) => {
        currentRoom = next;
      },
      setHostMessageForRoom: (_roomId: string, message: string | null) => {
        hostMessage = message ?? "";
      },
      getHostHandoffSnapshot: () => ({
        selectedRoomId: room.id,
        room: currentRoom,
        isActiveHost: currentRoom.hostUserId === "github:candidate" && currentRoom.hostStatus === "active",
        hostHandoffs: []
      })
    };
    const { result } = renderHook(() => useHostHandoffActions(input));

    await act(() => result.current.setRoomHost("active"));

    assert.equal(currentRoom.hostUserId, "github:other-host");
    assert.equal(publishes, 0);
    assert.match(hostMessage, /room host changed/);
  } finally {
    localStorage.removeItem("multaiplayer:app-config");
    globalThis.fetch = originalFetch;
  }
});

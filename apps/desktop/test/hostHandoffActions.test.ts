import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { useHostHandoffActions } from "../src/hooks/useHostHandoffActions";
import type { UseHostHandoffActionsOptions } from "../src/hooks/hostHandoffActionTypes";
import { useAppStore } from "../src/store/appStore";
import type { HostHandoffRecord } from "../src/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });

const tauriInternals = {
  invoke: async (command: string, args?: { request?: Record<string, unknown> }) => {
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
  hostStatus: "handoff",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.5",
  browserAllowedOrigins: [],
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
  approvalDelegationPolicy: room.approvalDelegationPolicy,
  trustedApproverUserIds: [],
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
    appendHostHandoff: noop
  };
}

beforeEach(() => {
  cleanup();
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

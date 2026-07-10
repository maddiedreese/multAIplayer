import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { cleanup, render, renderHook } from "@testing-library/react";
import { createElement, StrictMode, useLayoutEffect, type ReactNode } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createShellInput } from "../src/hooks/appViewModelShell";
import type { UseInviteActionsOptions } from "../src/lib/invite/inviteActionTypes";
import { useInviteActions } from "../src/hooks/useInviteActions";
import { useStablePlainObjectComposition } from "../src/hooks/useStablePlainObjectComposition";
import { useAppStore } from "../src/store/appStore";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: dom.window
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: dom.window.document
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator
});
Object.assign(globalThis, {
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement
});

afterEach(() => cleanup());
beforeEach(() => useAppStore.getState().resetAppStore());

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

const room: RoomRecord = {
  id: "room-invite",
  teamId: "team-alpha",
  name: "Invite",
  projectPath: "/tmp/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.5",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

const noop = () => undefined;
const inviteOptions: UseInviteActionsOptions = {
  hasSelectedRoom: true,
  selectedRoom: room,
  selectedRoomIdRef: { current: room.id },
  isSelectedRoomLocked: false,
  isSelectedRoomRevoked: false,
  isActiveHost: true,
  hostGateMessage: "Only the host can decide.",
  inviteApprovalGate: true,
  inviteRequests: [],
  inviteSecretInput: "",
  localUser: { id: "github:maddie", name: "Maddie" },
  deviceId: "device-local",
  deviceIdentity: null,
  relayStatus: "open",
  relayRef: { current: null },
  seenEnvelopeIds: { current: new Set<string>() },
  historyLoadedRoomIds: { current: new Set<string>() },
  reportRoomKeyRotationInFlight: () => false,
  upsertTeam: noop,
  upsertRoom: noop,
  clearInviteSecretInput: noop,
  selectWorkspaceRoom: noop
};

test("invite action identities survive wrapper-object rerenders", () => {
  const { result, rerender } = renderHook(
    ({ options }: { options: UseInviteActionsOptions }) => useInviteActions(options),
    {
      initialProps: { options: inviteOptions },
      wrapper: StrictModeWrapper
    }
  );
  const first = result.current;

  rerender({ options: { ...inviteOptions } });

  assert.equal(result.current, first);
  assert.equal(result.current.acceptInvite, first.acceptInvite);
  assert.equal(result.current.copyInviteLink, first.copyInviteLink);
  assert.equal(result.current.decideInviteJoinRequest, first.decideInviteJoinRequest);
  assert.equal(result.current.rotateSelectedRoomKey, first.rotateSelectedRoomKey);
});

test("stable invite actions call the latest implementation after inputs change", async () => {
  const { result, rerender } = renderHook(
    ({ options }: { options: UseInviteActionsOptions }) => useInviteActions(options),
    { initialProps: { options: inviteOptions } }
  );
  const first = result.current;

  rerender({
    options: {
      ...inviteOptions,
      hasSelectedRoom: false
    }
  });
  await result.current.copyInviteLink();

  assert.equal(result.current, first);
  assert.equal(result.current.joinInviteSecret, first.joinInviteSecret);
  assert.equal(result.current.copyInviteLink, first.copyInviteLink);
  assert.equal(result.current.decideInviteJoinRequest, first.decideInviteJoinRequest);
  assert.equal(result.current.rotateSelectedRoomKey, first.rotateSelectedRoomKey);
  assert.equal(
    useAppStore.getState().inviteByRoom[room.id]?.message,
    "Create or join a room before copying an invite."
  );
});

test("view-model compositions preserve identities until rendered data changes", () => {
  const beginShellResize = () => undefined;
  const toggleSidebarCollapsed = () => undefined;
  const toggleInspectorCollapsed = () => undefined;
  const shellLayout = {
    sidebarCollapsed: false,
    inspectorCollapsed: false,
    shellStyle: { "--sidebar-width": "280px" },
    beginShellResize,
    toggleSidebarCollapsed,
    toggleInspectorCollapsed
  };
  const createOptions = (sidebarCollapsed = false) => ({
    appState: {
      shellLayout: { ...shellLayout, sidebarCollapsed }
    }
  }) as unknown as Parameters<typeof createShellInput>[0];
  const { result, rerender } = renderHook(
    ({ options }: { options: Parameters<typeof createShellInput>[0] }) =>
      useStablePlainObjectComposition(createShellInput(options)),
    { initialProps: { options: createOptions() } }
  );
  const first = result.current;

  rerender({ options: createOptions() });
  assert.equal(result.current, first);
  assert.equal(result.current.onBeginSidebarResize, first.onBeginSidebarResize);

  rerender({ options: createOptions(true) });
  assert.notEqual(result.current, first);
  assert.equal(result.current.sidebarCollapsed, true);
});

test("layout-effect consumers observe the latest callback implementation", () => {
  const calls: number[] = [];

  function LayoutEffectConsumer({ callback, version }: { callback: () => void; version: number }) {
    useLayoutEffect(() => {
      callback();
    }, [callback, version]);
    return null;
  }

  function Composition({ version }: { version: number }) {
    const stable = useStablePlainObjectComposition({
      callback: () => calls.push(version)
    });
    return createElement(LayoutEffectConsumer, { callback: stable.callback, version });
  }

  const view = render(createElement(Composition, { version: 1 }));
  view.rerender(createElement(Composition, { version: 2 }));

  assert.deepEqual(calls, [1, 2]);
});

test("arrays remain opaque and callbacks inside them are not proxied", () => {
  const firstCallback = () => "first";
  const secondCallback = () => "second";
  const firstItems = [firstCallback];
  const secondItems = [secondCallback];
  const { result, rerender } = renderHook(
    ({ items }: { items: Array<() => string> }) =>
      useStablePlainObjectComposition({ items }),
    { initialProps: { items: firstItems } }
  );

  assert.equal(result.current.items, firstItems);
  assert.equal(result.current.items[0], firstCallback);

  rerender({ items: secondItems });

  assert.equal(result.current.items, secondItems);
  assert.equal(result.current.items[0], secondCallback);
});

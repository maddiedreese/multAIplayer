import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createNativeInviteIntake, type NativeInvitePayload } from "../src/lib/nativeInviteIntake";
import { useNativeInviteIntake } from "../src/hooks/useNativeInviteIntake";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});

Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });

test.afterEach(() => cleanup());

test("native invite intake subscribes before consuming a cold-start invite and consumes it once", async () => {
  const order: string[] = [];
  const pending: Array<NativeInvitePayload | null> = [{ inviteId: "invite_1", encodedInvite: "capability_1" }, null];
  const received: NativeInvitePayload[] = [];
  let stopped = false;

  const stop = await createNativeInviteIntake(
    {
      listen: async (event) => {
        order.push(`listen:${event}`);
        return () => {
          stopped = true;
        };
      },
      invoke: async () => {
        order.push("consume");
        return pending.shift() ?? null;
      }
    },
    (invite) => received.push(invite)
  );

  assert.deepEqual(order, ["listen:native-invite://available", "consume"]);
  assert.deepEqual(received, [{ inviteId: "invite_1", encodedInvite: "capability_1" }]);
  stop();
  assert.equal(stopped, true);
});

test("warm availability events carry no capability and drain the replacing native slot", async () => {
  let notify: (() => void) | undefined;
  let pending: NativeInvitePayload | null = null;
  const received: NativeInvitePayload[] = [];

  const stop = await createNativeInviteIntake(
    {
      listen: async (_event, handler) => {
        notify = handler;
        return () => undefined;
      },
      invoke: async () => {
        const current = pending;
        pending = null;
        return current;
      }
    },
    (invite) => received.push(invite)
  );

  pending = { inviteId: "invite_warm", encodedInvite: "capability_warm" };
  notify?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ inviteId: "invite_warm", encodedInvite: "capability_warm" }]);
  stop();
});

test("StrictMode abandons a deferred installer without draining the one-shot native invite", async () => {
  const pending: Array<NativeInvitePayload | null> = [
    { inviteId: "invite_strict", encodedInvite: "capability_strict" },
    null
  ];
  const listenerInstalls: Array<{
    resolve: (unlisten: () => void) => void;
    handler: () => void;
  }> = [];
  let drains = 0;
  const installer = (onInvite: (invite: NativeInvitePayload) => void | Promise<void>, signal?: AbortSignal) =>
    createNativeInviteIntake(
      {
        listen: async (_event, handler) =>
          new Promise((resolve) => {
            listenerInstalls.push({ resolve, handler });
          }),
        invoke: async () => {
          drains += 1;
          return pending.shift() ?? null;
        }
      },
      onInvite,
      signal
    );

  const { result } = renderHook(() => useNativeInviteIntake(installer), { reactStrictMode: true });
  await waitFor(() => assert.equal(listenerInstalls.length, 2));

  listenerInstalls[0]!.resolve(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drains, 0, "the abandoned StrictMode installer destructively drained the invite");

  listenerInstalls[1]!.resolve(() => undefined);
  await waitFor(() => assert.equal(result.current.invite?.inviteId, "invite_strict"));
  assert.equal(drains, 1);
  assert.deepEqual(result.current.invite, {
    inviteId: "invite_strict",
    encodedInvite: "capability_strict"
  });
});

test("a quick hook unmount cancels deferred native intake before its destructive drain", async () => {
  let resolveListener: ((unlisten: () => void) => void) | undefined;
  let drains = 0;
  const installer = (onInvite: (invite: NativeInvitePayload) => void | Promise<void>, signal?: AbortSignal) =>
    createNativeInviteIntake(
      {
        listen: async () =>
          new Promise((resolve) => {
            resolveListener = resolve;
          }),
        invoke: async () => {
          drains += 1;
          return { inviteId: "invite_unmount", encodedInvite: "capability_unmount" };
        }
      },
      onInvite,
      signal
    );

  const intake = renderHook(() => useNativeInviteIntake(installer));
  await waitFor(() => assert.ok(resolveListener));
  intake.unmount();
  resolveListener?.(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(drains, 0);
});

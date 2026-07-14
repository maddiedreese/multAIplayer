import assert from "node:assert/strict";
import test from "node:test";
import { createNativeInviteIntake, type NativeInvitePayload } from "../src/lib/nativeInviteIntake";

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

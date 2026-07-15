import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { RelayPublishRejectedError } from "../src/lib/relay/relayClient";

let outboxItems: unknown[] = [];
const retired: Array<{ roomId: string; messageId: string }> = [];

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined
  }
});
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string, args?: { request?: { roomId?: string; messageId?: string } }) => {
      if (command === "mls_outbox_list") return outboxItems;
      if (command === "mls_retire_stale_application") {
        retired.push({ roomId: args?.request?.roomId ?? "", messageId: args?.request?.messageId ?? "" });
        return 1;
      }
      throw new Error(`Unexpected command ${command}`);
    }
  }
});

const { drainMlsOutboxForRoom, pendingMlsOutboxRoomIds, recoverRoomAfterJoin } =
  await import("../src/application/mls/mlsOutboxDrain");

beforeEach(() => {
  retired.length = 0;
  outboxItems = [
    { id: "a", roomId: "room-b", epoch: 1, kind: "application", payload: "AA==" },
    { id: "b", roomId: "room-a", epoch: 2, kind: "commit", payload: "AA==" },
    { id: "c", roomId: "room-b", epoch: 3, kind: "welcome", payload: "AA==" }
  ];
});

test("startup audit surfaces every room with durable pending MLS work", async () => {
  assert.deepEqual(await pendingMlsOutboxRoomIds(), ["room-a", "room-b"]);
});

test("startup drain retires an exact application that exceeded the retained epoch window", async () => {
  const authenticatedData = JSON.stringify({
    version: 1,
    epoch: 4,
    messageId: "expired-app",
    teamId: "team-a",
    roomId: "room-a",
    kind: "chat.message",
    senderUserId: "github:user-a",
    senderDeviceId: "device-a",
    createdAt: "2026-07-12T12:00:00.000Z"
  });
  outboxItems = [
    {
      id: "expired-app",
      roomId: "room-a",
      epoch: 4,
      kind: "application",
      payload: "AA==",
      metadata: { type: "application", authenticatedData: [...new TextEncoder().encode(authenticatedData)] }
    }
  ];
  const room = { id: "room-a", teamId: "team-a" } as ClientRoomRecord;
  await drainMlsOutboxForRoom(
    {
      publish: () => undefined,
      publishAndWaitForAck: async ({ message }) => {
        throw new RelayPublishRejectedError("application_epoch_expired", message.id, "expired");
      },
      joinAndWaitForAck: async () => undefined,
      close: () => undefined
    },
    room,
    { userId: "github:user-a", deviceId: "device-a", deviceSessionToken: "session-a" }
  );
  assert.deepEqual(retired, [{ roomId: "room-a", messageId: "expired-app" }]);
});

test("host reconnect re-emits config after draining durable Add-era outbox work", async () => {
  const order: string[] = [];
  const client = {} as Parameters<typeof recoverRoomAfterJoin>[0];
  const room = {
    id: "room-a",
    teamId: "team-a",
    projectPath: "/private/project",
    hostStatus: "active",
    hostUserId: "github:host",
    activeHostDeviceId: "device-host"
  } as ClientRoomRecord;
  const identity = { userId: "github:host", deviceId: "device-host", deviceSessionToken: "session" };
  await recoverRoomAfterJoin(client, room, identity, new Set(), {
    drain: async () => void order.push("drain"),
    publishConfig: async ({ room: published }) => {
      order.push(`config:${published.projectPath}`);
      return published;
    }
  });
  assert.deepEqual(order, ["drain", "config:/private/project"]);
});

test("failed config re-emission remains retryable on the next reconnect", async () => {
  const client = {} as Parameters<typeof recoverRoomAfterJoin>[0];
  const room = {
    id: "room-a",
    teamId: "team-a",
    projectPath: "/private/project",
    hostStatus: "active",
    hostUserId: "github:host",
    activeHostDeviceId: "device-host"
  } as ClientRoomRecord;
  const identity = { userId: "github:host", deviceId: "device-host", deviceSessionToken: "session" };
  let attempts = 0;
  const dependencies = {
    drain: async () => undefined,
    publishConfig: async ({ room: published }: { room: ClientRoomRecord }) => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return published;
    }
  };
  await assert.rejects(recoverRoomAfterJoin(client, room, identity, new Set(), dependencies), /offline/);
  await recoverRoomAfterJoin(client, room, identity, new Set(), dependencies);
  assert.equal(attempts, 2);
});

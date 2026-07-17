import assert from "node:assert/strict";
import test from "node:test";
import { connectRelay, RelayPublishRejectedError } from "../src/lib/relay/relayClient";

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static latest: FakeWebSocket;
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  constructor(readonly url: string) {
    super();
    FakeWebSocket.latest = this;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  send(value: string) {
    this.sent.push(value);
  }
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
  receiveRaw(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: value }));
  }
}

Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { setTimeout, clearTimeout }
});

const publishMessage = {
  type: "publish" as const,
  message: {
    id: "message-ack-test",
    teamId: "team-test",
    roomId: "room-test",
    senderDeviceId: "device-test",
    senderUserId: "user-test",
    createdAt: "2026-07-10T12:00:00.000Z",
    messageType: "application" as const,
    epochHint: 1,
    mlsMessage: "AA=="
  }
};

test("publishAndWaitForAck resolves only for the matching persisted MLS acknowledgement", async () => {
  const received: string[] = [];
  const client = connectRelay(
    "ws://relay",
    (message) => {
      received.push(message.type);
    },
    () => undefined
  );
  FakeWebSocket.latest.open();
  const acknowledged = client.publishAndWaitForAck(publishMessage, 100);
  assert.equal(FakeWebSocket.latest.sent.length, 1);
  FakeWebSocket.latest.receive({ type: "published", messageId: publishMessage.message.id });
  await acknowledged;
  assert.deepEqual(received, ["published"]);
  client.close();
});

test("publishAndWaitForAck rejects on timeout and relay error", async () => {
  const timeoutClient = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  await assert.rejects(timeoutClient.publishAndWaitForAck(publishMessage, 5), /Timed out/);
  timeoutClient.close();

  const errorClient = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  const rejected = errorClient.publishAndWaitForAck(publishMessage, 100);
  FakeWebSocket.latest.receive({
    type: "error",
    message: "publish rejected",
    code: "stale_epoch",
    messageId: publishMessage.message.id
  });
  await assert.rejects(rejected, (error) => error instanceof RelayPublishRejectedError && error.code === "stale_epoch");
  errorClient.close();

  const closedClient = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  const closed = closedClient.publishAndWaitForAck(publishMessage, 100);
  FakeWebSocket.latest.close();
  await assert.rejects(closed, /closed before publish acknowledgement/);
  closedClient.close();
});

test("unscoped relay errors reject pending acknowledged operations without masking the cause", async () => {
  const client = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  const published = client.publishAndWaitForAck(publishMessage, 100);
  const joined = client.joinAndWaitForAck(
    {
      type: "join",
      teamId: "team-other",
      roomId: "room-other",
      userId: "user-test",
      deviceId: "device-test",
      deviceSessionToken: "session-test"
    },
    100
  );

  FakeWebSocket.latest.receive({ type: "error", message: "MLS envelope failed relay preflight validation." });

  await assert.rejects(published, /failed relay preflight validation/);
  await assert.rejects(joined, /failed relay preflight validation/);
  client.close();
});

test("scoped relay errors still reject only their matching publish", async () => {
  const client = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  const first = client.publishAndWaitForAck(publishMessage, 100);
  const secondMessage = {
    ...publishMessage,
    message: { ...publishMessage.message, id: "message-ack-test-2" }
  };
  const second = client.publishAndWaitForAck(secondMessage, 100);

  FakeWebSocket.latest.receive({
    type: "error",
    message: "publish rejected",
    code: "stale_epoch",
    messageId: publishMessage.message.id
  });
  await assert.rejects(first, (error) => error instanceof RelayPublishRejectedError && error.code === "stale_epoch");

  FakeWebSocket.latest.receive({ type: "published", messageId: secondMessage.message.id });
  await second;
  client.close();
});

test("malformed relay JSON fails closed without reaching application handlers", async () => {
  const received: string[] = [];
  const statuses: string[] = [];
  const client = connectRelay(
    "ws://relay",
    (message) => {
      received.push(message.type);
    },
    (status) => statuses.push(status)
  );
  const socket = FakeWebSocket.latest;
  socket.open();
  const pending = client.publishAndWaitForAck(publishMessage, 100);

  socket.receiveRaw("{not-json");

  await assert.rejects(pending, /invalid server message/);
  assert.deepEqual(received, []);
  assert.deepEqual(socket.closedWith, [1002, "Invalid relay server message"]);
  assert.deepEqual(statuses, ["connecting", "open", "error", "closed"]);
  client.close();
});

test("relay messages that violate the protocol schema fail closed", async () => {
  let handled = false;
  const client = connectRelay(
    "ws://relay",
    () => {
      handled = true;
    },
    () => undefined
  );
  const socket = FakeWebSocket.latest;
  socket.open();
  const pending = client.joinAndWaitForAck(
    {
      type: "join",
      teamId: "team-test",
      roomId: "room-test",
      userId: "user-test",
      deviceId: "device-test",
      deviceSessionToken: "session-test"
    },
    100
  );

  socket.receive({ type: "joined", teamId: "team-test" });

  await assert.rejects(pending, /invalid server message/);
  assert.equal(handled, false);
  assert.deepEqual(socket.closedWith, [1002, "Invalid relay server message"]);
  client.close();
});

test("joinAndWaitForAck resolves only after exact relay room admission", async () => {
  const client = connectRelay(
    "ws://relay",
    () => undefined,
    () => undefined
  );
  FakeWebSocket.latest.open();
  const joined = client.joinAndWaitForAck(
    {
      type: "join",
      teamId: "team-test",
      roomId: "room-test",
      userId: "user-test",
      deviceId: "device-test",
      deviceSessionToken: "session-test"
    },
    100
  );
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-other", roomId: "room-other" });
  let settled = false;
  void joined.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-test", roomId: "room-test" });
  await joined;
  client.close();
});

test("applies relay server messages in wire order across asynchronous handlers", async () => {
  const applied: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const client = connectRelay(
    "ws://relay",
    async (message) => {
      applied.push(`start:${message.type}`);
      if (message.type === "joined") await firstBlocked;
      applied.push(`finish:${message.type}`);
    },
    () => undefined
  );
  FakeWebSocket.latest.open();
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-test", roomId: "room-test" });
  FakeWebSocket.latest.receive({ type: "invite.requested", inviteId: "invite-test", requestId: "request-test" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, ["start:joined"]);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, ["start:joined", "finish:joined", "start:invite.requested", "finish:invite.requested"]);
  client.close();
});

test("continues ordered relay processing after an asynchronous handler rejects", async () => {
  const applied: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const client = connectRelay(
      "ws://relay",
      async (message) => {
        applied.push(message.type);
        if (message.type === "joined") throw new Error("ordered handler failed");
      },
      () => undefined
    );
    FakeWebSocket.latest.open();
    FakeWebSocket.latest.receive({ type: "joined", teamId: "team-test", roomId: "room-test" });
    FakeWebSocket.latest.receive({ type: "invite.requested", inviteId: "invite-test", requestId: "request-test" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(applied, ["joined", "invite.requested"]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.[0], "Non-fatal failure: apply an ordered relay server message");
    assert.match(String(warnings[0]?.[1]), /ordered handler failed/);
    client.close();
  } finally {
    console.warn = originalWarn;
  }
});

test("resolves a normal join after prior replay but before a blocked joined handler", async () => {
  let releaseReplay!: () => void;
  let releaseJoined!: () => void;
  const replayBlocked = new Promise<void>((resolve) => (releaseReplay = resolve));
  const joinedBlocked = new Promise<void>((resolve) => (releaseJoined = resolve));
  const applied: string[] = [];
  const client = connectRelay(
    "ws://relay",
    async (message) => {
      applied.push(`start:${message.type}`);
      if (message.type === "mls.message") await replayBlocked;
      if (message.type === "joined") await joinedBlocked;
      applied.push(`finish:${message.type}`);
    },
    () => undefined
  );
  FakeWebSocket.latest.open();
  const joined = client.joinAndWaitForAck(
    {
      type: "join",
      teamId: "team-test",
      roomId: "room-test",
      userId: "user-test",
      deviceId: "device-test",
      deviceSessionToken: "session-test"
    },
    100
  );
  FakeWebSocket.latest.receive({ type: "mls.message", message: publishMessage.message });
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-test", roomId: "room-test" });
  let settled = false;
  void joined.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.deepEqual(applied, ["start:mls.message"]);

  releaseReplay();
  await joined;
  assert.deepEqual(applied, ["start:mls.message", "finish:mls.message", "start:joined"]);
  releaseJoined();
  await new Promise((resolve) => setTimeout(resolve, 0));
  client.close();
});

test("an explicit backlog rejoin can resolve from inside an ordered handler without deadlock", async () => {
  const applied: string[] = [];
  let appliedEpoch = 0;
  let epochWhenRejoinResolved = -1;
  let rejoined: Promise<void> | null = null;
  const client = connectRelay(
    "ws://relay",
    async (message) => {
      applied.push(message.type);
      if (message.type === "mls.message") appliedEpoch = message.message.epochHint;
      if (message.type !== "invite.requested") return;
      rejoined = client.rejoinForBacklog(
        {
          type: "join",
          teamId: "team-test",
          roomId: "room-test",
          userId: "user-test",
          deviceId: "device-test",
          deviceSessionToken: "session-test"
        },
        100
      );
      await rejoined;
      epochWhenRejoinResolved = appliedEpoch;
    },
    () => undefined
  );
  FakeWebSocket.latest.open();
  FakeWebSocket.latest.receive({ type: "invite.requested", inviteId: "invite-test", requestId: "request-test" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(rejoined);
  FakeWebSocket.latest.receive({ type: "mls.message", message: publishMessage.message });
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-test", roomId: "room-test" });
  await rejoined;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, ["invite.requested", "mls.message", "joined"]);
  assert.equal(epochWhenRejoinResolved, 0, "reentrant acknowledgement must let the active handler release first");
  assert.equal(appliedEpoch, publishMessage.message.epochHint, "queued backlog applies after the handler releases");
  client.close();
});

test("an unrelated normal join started during another handler still waits for replay", async () => {
  let releaseHandler!: () => void;
  const handlerBlocked = new Promise<void>((resolve) => (releaseHandler = resolve));
  const client = connectRelay(
    "ws://relay",
    async (message) => {
      if (message.type === "invite.requested") await handlerBlocked;
    },
    () => undefined
  );
  FakeWebSocket.latest.open();
  FakeWebSocket.latest.receive({ type: "invite.requested", inviteId: "invite-test", requestId: "request-test" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const joined = client.joinAndWaitForAck(
    {
      type: "join",
      teamId: "team-other",
      roomId: "room-other",
      userId: "user-test",
      deviceId: "device-test",
      deviceSessionToken: "session-test"
    },
    100
  );
  FakeWebSocket.latest.receive({ type: "joined", teamId: "team-other", roomId: "room-other" });
  let settled = false;
  void joined.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  releaseHandler();
  await joined;
  client.close();
});

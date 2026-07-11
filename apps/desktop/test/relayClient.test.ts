import assert from "node:assert/strict";
import test from "node:test";
import { connectRelay } from "../src/lib/relayClient";

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static latest: FakeWebSocket;
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
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
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { setTimeout, clearTimeout }
});

const publishMessage = {
  type: "publish" as const,
  envelope: {
    id: "envelope-ack-test",
    teamId: "team-test",
    roomId: "room-test",
    senderDeviceId: "device-test",
    senderUserId: "user-test",
    createdAt: "2026-07-10T12:00:00.000Z",
    kind: "room.key" as const,
    keyEpoch: 1,
    payload: { version: 2 as const, algorithm: "AES-GCM-256" as const, nonce: "nonce", ciphertext: "ciphertext" }
  }
};

test("publishAndWaitForAck resolves only for the matching persisted-envelope acknowledgement", async () => {
  const received: string[] = [];
  const client = connectRelay(
    "ws://relay",
    (message) => received.push(message.type),
    () => undefined
  );
  FakeWebSocket.latest.open();
  const acknowledged = client.publishAndWaitForAck(publishMessage, 100);
  assert.equal(FakeWebSocket.latest.sent.length, 1);
  FakeWebSocket.latest.receive({ type: "published", envelopeId: publishMessage.envelope.id });
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
  FakeWebSocket.latest.receive({ type: "error", message: "publish rejected" });
  await assert.rejects(rejected, /publish rejected/);
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

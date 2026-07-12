import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CodexAppServerClient,
  type CodexAppServerTransport,
  type CodexScheduler,
  type CodexTransportHandlers,
  type JsonRpcMessage,
  type JsonRpcResponse
} from "../src/index";

class FakeTransport implements CodexAppServerTransport {
  handlers?: CodexTransportHandlers;
  sent: Array<JsonRpcMessage | JsonRpcResponse> = [];
  starts = 0;
  closes = 0;
  sendError?: Error;
  start(handlers: CodexTransportHandlers): void {
    this.starts++;
    this.handlers = handlers;
  }
  send(message: JsonRpcMessage | JsonRpcResponse): void {
    if (this.sendError) throw this.sendError;
    this.sent.push(message);
  }
  close(): void {
    this.closes++;
  }
  message(value: unknown): void {
    this.handlers!.message(JSON.stringify(value));
  }
}

class FakeScheduler implements CodexScheduler {
  next = 0;
  callbacks = new Map<number, () => void>();
  cleared: unknown[] = [];
  setTimeout(callback: () => void): number {
    const id = ++this.next;
    this.callbacks.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.cleared.push(handle);
    this.callbacks.delete(handle as number);
  }
  fire(id: number): void {
    this.callbacks.get(id)?.();
    this.callbacks.delete(id);
  }
}

function harness(config = {}) {
  const transports: FakeTransport[] = [];
  const scheduler = new FakeScheduler();
  const client = new CodexAppServerClient(config, {
    createTransport: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
    scheduler
  });
  return { client, scheduler, transports, transport: () => transports.at(-1)! };
}

test("client lazily starts once and sends notifications and responses", () => {
  const { client, transport } = harness();
  client.notify({ method: "ready" });
  client.respond("server-1", { accepted: true });
  client.respondError("server-2", 400, "no");
  client.respondError("server-3", 401, "no", { reason: "auth" });
  client.start();
  assert.equal(transport().starts, 1);
  assert.deepEqual(transport().sent, [
    { method: "ready" },
    { id: "server-1", result: { accepted: true } },
    { id: "server-2", error: { code: 400, message: "no" } },
    { id: "server-3", error: { code: 401, message: "no", data: { reason: "auth" } } }
  ]);
});

test("client correlates responses and projects inbound events", async () => {
  const { client, scheduler, transport } = harness();
  const notifications: unknown[] = [];
  const requests: unknown[] = [];
  const orphans: unknown[] = [];
  const errors: Error[] = [];
  client.on("notification", (value) => notifications.push(value));
  client.on("serverRequest", (value) => requests.push(value));
  client.on("orphanResponse", (value) => orphans.push(value));
  client.on("protocolError", (value) => errors.push(value));
  const response = client.request({ method: "ping", id: 7 });
  transport().message({ id: 7, result: { ok: true } });
  assert.deepEqual(await response, { id: 7, result: { ok: true } });
  assert.deepEqual(scheduler.cleared, [1]);
  transport().message({ method: "turn/completed", params: {} });
  transport().message({ method: "approval", id: "server-1", params: {} });
  transport().message({ id: 99, result: {} });
  transport().handlers!.message("not json");
  transport().message({ id: 1 });
  assert.equal(notifications.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(orphans.length, 1);
  assert.equal(errors.length, 2);
});

test("request rejects duplicate ids, timeouts, and synchronous send failures", async () => {
  const { client, scheduler, transport } = harness();
  const first = client.request({ method: "slow", id: 1 }, 10);
  await assert.rejects(client.request({ method: "duplicate", id: 1 }), /Duplicate/);
  scheduler.fire(1);
  await assert.rejects(first, /Timed out.*slow/);
  transport().sendError = new Error("write failed");
  await assert.rejects(client.request({ method: "write", id: 2 }), /write failed/);
  assert.deepEqual(scheduler.cleared, [2]);
  transport().sendError = undefined;
  const late = new Promise<unknown>((resolve) => client.once("orphanResponse", resolve));
  transport().message({ id: 1, result: {} });
  await late;
});

test("initialize and turn helpers allocate monotonic ids and honor defaults", async () => {
  const { client, transport } = harness({ model: "configured", cwd: "/repo" });
  const initialized = client.initialize();
  transport().message({ id: 1, result: {} });
  await initialized;
  assert.equal((transport().sent[1] as JsonRpcMessage).method, "initialized");
  const thread = client.startThread();
  assert.deepEqual(transport().sent[2], { method: "thread/start", id: 2, params: { model: "configured" } });
  transport().message({ id: 2, result: { thread: { id: "thread-1" } } });
  assert.deepEqual(await thread, { thread: { id: "thread-1" } });
  const turn = client.startTurn("thread-1", "hello");
  assert.deepEqual(transport().sent[3], {
    method: "turn/start",
    id: 3,
    params: { threadId: "thread-1", input: [{ type: "text", text: "hello" }], cwd: "/repo" }
  });
  transport().message({ id: 3, result: {} });
  await turn;
});

test("thread errors reject and missing results normalize to an empty object", async () => {
  const { client, transport } = harness();
  const failed = client.startThread("bad");
  transport().message({ id: 1, error: { code: 1, message: "unsupported" } });
  await assert.rejects(failed, /unsupported/);
  const empty = client.startThread();
  transport().message({ id: 2, result: null });
  assert.deepEqual(await empty, {});
});

test("stderr, exit, close, and restart clean up pending work exactly once", async () => {
  const { client, transports, transport } = harness();
  const stderr: string[] = [];
  const exits: unknown[] = [];
  client.on("stderr", (value) => stderr.push(value));
  client.on("exit", (value) => exits.push(value));
  const pending = client.request({ method: "pending", id: 1 });
  transport().handlers!.stderr("warning");
  transport().handlers!.exit(9, null);
  await assert.rejects(pending, /exited with 9/);
  assert.deepEqual(stderr, ["warning"]);
  assert.deepEqual(exits, [{ code: 9, signal: null }]);
  client.notify({ method: "restart" });
  assert.equal(transports.length, 2);
  transports[0].handlers!.exit(1, null);
  assert.equal(exits.length, 1);
  const closing = client.request({ method: "closing", id: 2 });
  client.close();
  client.close();
  await assert.rejects(closing, /client closed/);
  assert.equal(transports[1].closes, 1);
});

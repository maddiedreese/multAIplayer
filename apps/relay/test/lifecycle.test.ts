import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Server } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";
import { createRelayLifecycle } from "../src/lifecycle.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class TestSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  closeCalls: Array<{ code: number; reason: string }> = [];
  terminateCalls = 0;

  close(code: number, reason: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = WebSocket.CLOSING;
  }

  terminate() {
    this.terminateCalls += 1;
    this.readyState = WebSocket.CLOSED;
  }
}

function createServer(onClose: () => void): Server {
  return {
    close(callback: (error?: Error) => void) {
      onClose();
      callback();
    }
  } as unknown as Server;
}

function createWebSocketServer(socket: TestSocket, onClose: () => void): WebSocketServer {
  return {
    clients: new Set([socket]),
    close(callback: () => void) {
      onClose();
      callback();
    }
  } as unknown as WebSocketServer;
}

async function nextTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("shutdown drains before closing listeners, sockets, or the store", async () => {
  const drain = deferred();
  const grace = deferred();
  const waits: number[] = [];
  const events: string[] = [];
  const socket = new TestSocket();
  const lifecycle = createRelayLifecycle({
    server: createServer(() => events.push("server.close")),
    wss: createWebSocketServer(socket, () => events.push("wss.close")),
    drainMs: 250,
    graceMs: 500,
    closeStore: async () => {
      events.push("store.close");
    },
    wait: (ms) => {
      waits.push(ms);
      return ms === 250 ? drain.promise : grace.promise;
    }
  });

  const shutdown = lifecycle.shutdown();

  assert.equal(lifecycle.isReady(), false);
  assert.deepEqual(waits, [250]);
  assert.deepEqual(events, []);
  assert.deepEqual(socket.closeCalls, []);

  drain.resolve();
  await nextTurn();

  assert.deepEqual(waits, [250, 500]);
  assert.deepEqual(events, ["server.close", "wss.close"]);
  assert.deepEqual(socket.closeCalls, [
    { code: 1012, reason: "Relay shutting down" }
  ]);
  assert.equal(socket.terminateCalls, 0);
  assert.equal(events.includes("store.close"), false);

  socket.readyState = WebSocket.CLOSED;
  socket.emit("close");
  await shutdown;

  assert.equal(socket.terminateCalls, 0);
  assert.deepEqual(events, ["server.close", "wss.close", "store.close"]);
});

test("shutdown terminates sockets that remain open through the grace period", async () => {
  const grace = deferred();
  const waits: number[] = [];
  const events: string[] = [];
  const socket = new TestSocket();
  const lifecycle = createRelayLifecycle({
    server: createServer(() => events.push("server.close")),
    wss: createWebSocketServer(socket, () => events.push("wss.close")),
    drainMs: 0,
    graceMs: 750,
    closeStore: async () => {
      events.push("store.close");
    },
    wait: (ms) => {
      waits.push(ms);
      return grace.promise;
    }
  });

  const shutdown = lifecycle.shutdown();
  await nextTurn();

  assert.deepEqual(waits, [750]);
  assert.equal(socket.terminateCalls, 0);
  assert.equal(events.includes("store.close"), false);

  grace.resolve();
  await shutdown;

  assert.equal(socket.terminateCalls, 1);
  assert.deepEqual(events, ["server.close", "wss.close", "store.close"]);
});

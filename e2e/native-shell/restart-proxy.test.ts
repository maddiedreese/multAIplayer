import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { RestartableRelayProxy } from "./restart-proxy.js";

test("holds an invite response until it can be delivered to a restarted relay target", async () => {
  const oldTarget = await targetServer("old");
  const newTarget = await targetServer("new");
  const proxy = await RestartableRelayProxy.start(oldTarget.url);
  try {
    assert.equal(await fetch(`${proxy.baseUrl}/health`).then((response) => response.text()), "old:/health");

    const gate = proxy.armInviteResponseGate();
    assert.equal(
      await fetch(`${proxy.baseUrl}/invites/invite-a/response/request-a/ack`, { method: "POST" }).then((response) =>
        response.text()
      ),
      "old:/invites/invite-a/response/request-a/ack"
    );
    const response = fetch(`${proxy.baseUrl}/invites/invite-a/response`, {
      method: "POST",
      body: "durable Welcome"
    }).then(async (result) => ({ status: result.status, body: await result.text() }));
    await gate.blocked;
    assert.deepEqual(oldTarget.requests, ["GET /health", "POST /invites/invite-a/response/request-a/ack"]);

    proxy.setTarget(newTarget.url);
    gate.release();
    assert.deepEqual(await response, { status: 201, body: "new:/invites/invite-a/response:durable Welcome" });
    assert.deepEqual(oldTarget.requests, ["GET /health", "POST /invites/invite-a/response/request-a/ack"]);
    assert.deepEqual(newTarget.requests, ["POST /invites/invite-a/response"]);
  } finally {
    await proxy.close();
    await Promise.all([closeServer(oldTarget.server), closeServer(newTarget.server)]);
  }
});

test("routes new WebSocket connections to the swapped relay target", async () => {
  const oldTarget = await websocketTarget("old");
  const newTarget = await websocketTarget("new");
  const proxy = await RestartableRelayProxy.start(oldTarget.url);
  try {
    assert.equal(await websocketMessage(proxy.wsUrl), "old");
    proxy.setTarget(newTarget.url);
    assert.equal(await websocketMessage(proxy.wsUrl), "new");
  } finally {
    await proxy.close();
    await Promise.all([closeServer(oldTarget.server), closeServer(newTarget.server)]);
  }
});

test("closing the proxy cancels a gated request without opening an upstream connection", async () => {
  const target = await targetServer("target");
  const proxy = await RestartableRelayProxy.start(target.url);
  try {
    const gate = proxy.armInviteResponseGate();
    const response = fetch(`${proxy.baseUrl}/invites/invite-a/response`, { method: "POST", body: "Welcome" });
    await gate.blocked;
    await proxy.close();
    await assert.rejects(response);
    assert.deepEqual(target.requests, []);
  } finally {
    await proxy.close();
    await closeServer(target.server);
  }
});

async function targetServer(name: string) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(`${request.method} ${request.url}`);
      const body = Buffer.concat(chunks).toString("utf8");
      response.writeHead(request.method === "POST" ? 201 : 200);
      response.end(`${name}:${request.url}${body ? `:${body}` : ""}`);
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("test target did not bind"));
      resolve(address.port);
    });
  });
  return { server, requests, url: `http://127.0.0.1:${port}` };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function websocketTarget(message: string) {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => socket.send(message));
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("WebSocket target did not bind"));
      resolve(address.port);
    });
  });
  return { server, url: `http://127.0.0.1:${port}` };
}

async function websocketMessage(url: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("message", (value) => {
      resolve(value.toString());
      socket.close();
    });
    socket.once("error", reject);
  });
}

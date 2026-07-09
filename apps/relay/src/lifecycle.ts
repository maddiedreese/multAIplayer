import type { Server } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";

export interface RelayLifecycle {
  isReady: () => boolean;
  shutdownMiddleware: (
    path: string,
    next: () => void,
    reject: () => void
  ) => void;
  closeServer: () => Promise<void>;
  shutdown: () => Promise<void>;
}

interface RelayLifecycleOptions {
  server: Server;
  wss: WebSocketServer;
  drainMs: number;
  graceMs: number;
  closeStore: () => Promise<void>;
}

export function createRelayLifecycle({
  server,
  wss,
  drainMs,
  graceMs,
  closeStore
}: RelayLifecycleOptions): RelayLifecycle {
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  function isReady() {
    return !shuttingDown;
  }

  function shutdownMiddleware(path: string, next: () => void, reject: () => void) {
    if (isReady() || isShutdownExemptPath(path)) {
      next();
      return;
    }
    reject();
  }

  function closeServer() {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async function shutdown() {
    if (!shutdownPromise) {
      shuttingDown = true;
      shutdownPromise = runShutdown();
    }
    await shutdownPromise;
  }

  async function runShutdown() {
    if (drainMs > 0) await delay(drainMs);
    const socketClose = closeWebSockets(wss, graceMs);
    await Promise.allSettled([
      closeServer(),
      closeWebSocketServer(wss)
    ]);
    await socketClose;
    await closeStore();
  }

  return {
    isReady,
    shutdownMiddleware,
    closeServer,
    shutdown
  };
}

function isShutdownExemptPath(path: string): boolean {
  return path === "/healthz" || path === "/readyz" || path === "/metrics";
}

async function closeWebSocketServer(wss: WebSocketServer) {
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}

async function closeWebSockets(wss: WebSocketServer, graceMs: number) {
  const sockets = Array.from(wss.clients);
  if (sockets.length === 0) return;
  const closed = Promise.all(sockets.map((socket) => waitForSocketClose(socket)));
  await Promise.race([
    closed,
    delay(graceMs).then(() => {
      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      }
    })
  ]);
}

function waitForSocketClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      socket.off("close", done);
      socket.off("error", done);
      resolve();
    };
    socket.once("close", done);
    socket.once("error", done);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1012, "Relay shutting down");
    }
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

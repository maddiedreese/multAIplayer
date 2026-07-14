import {
  createServer,
  request,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { connect, type Socket } from "node:net";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export interface RequestGate {
  blocked: Promise<void>;
  release: () => void;
}

/** Keeps the desktop relay URL stable while a real relay process is restarted. */
export class RestartableRelayProxy {
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly #server: Server;
  readonly #requests = new Set<ClientRequest>();
  readonly #sockets = new Set<Socket>();
  #closed = false;
  #target: URL;
  #inviteResponseGate: { blocked: Deferred; released: Deferred; matched: boolean } | null = null;

  private constructor(server: Server, port: number, target: URL) {
    this.#server = server;
    this.#target = target;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.wsUrl = `ws://127.0.0.1:${port}/rooms`;
  }

  static async start(targetBaseUrl: string): Promise<RestartableRelayProxy> {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("relay proxy did not bind a TCP port"));
        resolve(address.port);
      });
    });
    const proxy = new RestartableRelayProxy(server, port, new URL(targetBaseUrl));
    server.on("request", (incoming, response) => void proxy.#proxyHttp(incoming, response));
    server.on("upgrade", (incoming, socket, head) => proxy.#proxyWebSocket(incoming, socket, head));
    server.on("connection", (socket) => {
      proxy.#sockets.add(socket);
      // A killed WebView or relay restart can reset a proxied TCP stream. The
      // request-level paths report actionable failures; the raw socket must not
      // turn expected crash-test teardown into an uncaught process exception.
      socket.on("error", () => undefined);
      socket.once("close", () => proxy.#sockets.delete(socket));
    });
    return proxy;
  }

  setTarget(targetBaseUrl: string) {
    this.#target = new URL(targetBaseUrl);
  }

  armInviteResponseGate(): RequestGate {
    if (this.#inviteResponseGate) throw new Error("relay invite-response gate is already armed");
    const blocked = deferred();
    const released = deferred();
    this.#inviteResponseGate = { blocked, released, matched: false };
    return {
      blocked: blocked.promise,
      release: () => released.resolve()
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#inviteResponseGate?.released.resolve();
    for (const request of this.#requests) request.destroy();
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #proxyHttp(incoming: IncomingMessage, response: ServerResponse) {
    const gate = this.#inviteResponseGate;
    if (
      gate &&
      !gate.matched &&
      incoming.method === "POST" &&
      /^\/invites\/[^/]+\/response(?:\?|$)/.test(incoming.url ?? "")
    ) {
      gate.matched = true;
      gate.blocked.resolve();
      await gate.released.promise;
      this.#inviteResponseGate = null;
    }
    if (this.#closed) {
      response.destroy();
      return;
    }

    const target = this.#target;
    const upstream = request({
      hostname: target.hostname,
      port: target.port,
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers
    });
    this.#requests.add(upstream);
    upstream.once("close", () => this.#requests.delete(upstream));
    upstream.setTimeout(15_000, () => upstream.destroy(new Error("relay proxy upstream timed out")));
    upstream.once("response", (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.once("error", (error) => {
      if (!response.headersSent) response.writeHead(502);
      response.end(`Relay proxy error: ${error.message}`);
    });
    incoming.once("aborted", () => upstream.destroy());
    response.once("close", () => {
      if (!response.writableEnded) upstream.destroy();
    });
    incoming.pipe(upstream);
  }

  #proxyWebSocket(incoming: IncomingMessage, socket: Socket, head: Buffer) {
    const target = this.#target;
    const upstream = connect(Number(target.port), target.hostname);
    this.#sockets.add(upstream);
    upstream.once("close", () => this.#sockets.delete(upstream));
    upstream.once("connect", () => {
      upstream.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${incoming.rawHeaders
          .map((value, index) => `${value}${index % 2 === 0 ? ": " : "\r\n"}`)
          .join("")}\r\n`
      );
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.once("error", () => socket.destroy());
  }
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

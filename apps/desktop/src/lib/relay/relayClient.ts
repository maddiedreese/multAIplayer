import { RelayServerMessage, type RelayClientMessage } from "@multaiplayer/protocol";
import { relayWebSocketProtocols } from "./relaySession";

export class RelayPublishRejectedError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly messageId: string,
    message: string
  ) {
    super(message);
    this.name = "RelayPublishRejectedError";
  }
}

export function isStaleMlsPublish(error: unknown): error is RelayPublishRejectedError {
  return error instanceof RelayPublishRejectedError && error.code === "stale_epoch";
}

export function isExpiredMlsApplication(error: unknown): error is RelayPublishRejectedError {
  return error instanceof RelayPublishRejectedError && error.code === "application_epoch_expired";
}

export interface RelayClient {
  publish(message: RelayClientMessage): void;
  publishAndWaitForAck(message: Extract<RelayClientMessage, { type: "publish" }>, timeoutMs?: number): Promise<void>;
  joinAndWaitForAck(message: Extract<RelayClientMessage, { type: "join" }>, timeoutMs?: number): Promise<void>;
  /** In-handler stale-Commit escape hatch; normal callers must use joinAndWaitForAck. */
  rejoinForBacklog(message: Extract<RelayClientMessage, { type: "join" }>, timeoutMs?: number): Promise<void>;
  close(): void;
}

export function connectRelay(
  url: string,
  onMessage: (message: RelayServerMessage) => void | Promise<void>,
  onStatus: (status: "connecting" | "open" | "closed" | "error") => void,
  onOpen?: (client: RelayClient) => void
): RelayClient {
  const queue: RelayClientMessage[] = [];
  let socket: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let incomingMessageChain = Promise.resolve();
  const pendingAcks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: number }>();
  const pendingJoins = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timeout: number; resolveBeforeWatermark: boolean }
  >();

  const joinKey = (teamId: string, roomId: string) => `${teamId}\u0000${roomId}`;

  function rejectPendingAcks(error: Error) {
    for (const pending of pendingAcks.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingAcks.clear();
    for (const pending of pendingJoins.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingJoins.clear();
  }

  const client: RelayClient = {
    publish(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      } else {
        queue.push(message);
      }
    },
    publishAndWaitForAck(message, timeoutMs = 10_000) {
      const messageId = message.message.id;
      if (pendingAcks.has(messageId))
        return Promise.reject(new Error(`MLS message ${messageId} is already awaiting acknowledgement.`));
      if (socket?.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Relay is not open for acknowledged publishing."));
      }
      return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => {
            pendingAcks.delete(messageId);
            reject(new Error(`Timed out waiting for relay acknowledgement of MLS message ${messageId}.`));
          },
          Math.max(1, timeoutMs)
        );
        pendingAcks.set(messageId, { resolve, reject, timeout });
        socket!.send(JSON.stringify(message));
      });
    },
    joinAndWaitForAck(message, timeoutMs = 10_000) {
      return waitForJoin(message, timeoutMs, false);
    },
    rejoinForBacklog(message, timeoutMs = 10_000) {
      return waitForJoin(message, timeoutMs, true);
    },
    close() {
      closedByClient = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      rejectPendingAcks(new Error("Relay closed before publish acknowledgement."));
      socket?.close();
    }
  };

  function waitForJoin(
    message: Extract<RelayClientMessage, { type: "join" }>,
    timeoutMs: number,
    resolveBeforeWatermark: boolean
  ) {
    const key = joinKey(message.teamId, message.roomId);
    if (pendingJoins.has(key)) return Promise.reject(new Error("This relay room join is already pending."));
    if (socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Relay is not open for acknowledged joining."));
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => {
          pendingJoins.delete(key);
          reject(new Error("Timed out waiting for relay room admission."));
        },
        Math.max(1, timeoutMs)
      );
      pendingJoins.set(key, { resolve, reject, timeout, resolveBeforeWatermark });
      socket!.send(JSON.stringify(message));
    });
  }

  function connect() {
    onStatus("connecting");
    socket = new WebSocket(url, relayWebSocketProtocols(url));

    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      onStatus("open");
      onOpen?.(client);
      while (socket?.readyState === WebSocket.OPEN && queue.length > 0) {
        socket.send(JSON.stringify(queue.shift()));
      }
    });

    socket.addEventListener("close", () => {
      rejectPendingAcks(new Error("Relay connection closed before publish acknowledgement."));
      if (closedByClient) {
        onStatus("closed");
        return;
      }
      onStatus("closed");
      const delayMs = Math.min(10_000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delayMs);
    });

    socket.addEventListener("error", () => {
      rejectPendingAcks(new Error("Relay connection failed before publish acknowledgement."));
      onStatus("error");
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        rejectInvalidServerMessage(event.currentTarget as WebSocket);
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(event.data);
      } catch {
        rejectInvalidServerMessage(event.currentTarget as WebSocket);
        return;
      }
      const parsed = RelayServerMessage.safeParse(decoded);
      if (!parsed.success) {
        rejectInvalidServerMessage(event.currentTarget as WebSocket);
        return;
      }
      const message = parsed.data;
      if (message.type === "published") {
        const pending = pendingAcks.get(message.messageId);
        if (pending) {
          pendingAcks.delete(message.messageId);
          window.clearTimeout(pending.timeout);
          pending.resolve();
        }
      } else if (message.type === "error" && message.messageId) {
        const pending = pendingAcks.get(message.messageId);
        if (pending) {
          pendingAcks.delete(message.messageId);
          window.clearTimeout(pending.timeout);
          pending.reject(new RelayPublishRejectedError(message.code, message.messageId, message.message));
        }
      } else if (message.type === "error") {
        // Preflight, schema, and connection-level relay failures cannot always
        // carry an operation id. Fail closed instead of leaving an acknowledged
        // publish or join to report a misleading timeout later.
        rejectPendingAcks(new Error(message.message));
      }
      const joinedKey = message.type === "joined" ? joinKey(message.teamId, message.roomId) : null;
      const joinedPending = joinedKey ? pendingJoins.get(joinedKey) : undefined;
      if (joinedKey && joinedPending?.resolveBeforeWatermark) resolvePendingJoin(joinedKey, joinedPending);
      incomingMessageChain = incomingMessageChain
        .then(async () => {
          if (joinedKey && joinedPending && !joinedPending.resolveBeforeWatermark)
            resolvePendingJoin(joinedKey, joinedPending);
          await onMessage(message);
        })
        .catch((error) => console.warn("Non-fatal failure: apply an ordered relay server message", error));
    });
  }

  function rejectInvalidServerMessage(source: WebSocket) {
    rejectPendingAcks(new Error("Relay sent an invalid server message."));
    onStatus("error");
    source.close(1002, "Invalid relay server message");
  }

  function resolvePendingJoin(key: string, pending: { resolve: () => void; timeout: number }) {
    if (pendingJoins.get(key) !== pending) return;
    pendingJoins.delete(key);
    window.clearTimeout(pending.timeout);
    pending.resolve();
  }

  connect();
  return client;
}

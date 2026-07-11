import type { RelayClientMessage, RelayServerMessage } from "@multaiplayer/protocol";

export interface RelayClient {
  publish(message: RelayClientMessage): void;
  publishAndWaitForAck(message: Extract<RelayClientMessage, { type: "publish" }>, timeoutMs?: number): Promise<void>;
  close(): void;
}

export function connectRelay(
  url: string,
  onMessage: (message: RelayServerMessage) => void,
  onStatus: (status: "connecting" | "open" | "closed" | "error") => void,
  onOpen?: (client: RelayClient) => void
): RelayClient {
  const queue: RelayClientMessage[] = [];
  let socket: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  const pendingAcks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: number }>();

  function rejectPendingAcks(error: Error) {
    for (const pending of pendingAcks.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingAcks.clear();
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
      const envelopeId = message.envelope.id;
      if (pendingAcks.has(envelopeId))
        return Promise.reject(new Error(`Envelope ${envelopeId} is already awaiting acknowledgement.`));
      if (socket?.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Relay is not open for acknowledged publishing."));
      }
      return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => {
            pendingAcks.delete(envelopeId);
            reject(new Error(`Timed out waiting for relay acknowledgement of envelope ${envelopeId}.`));
          },
          Math.max(1, timeoutMs)
        );
        pendingAcks.set(envelopeId, { resolve, reject, timeout });
        socket!.send(JSON.stringify(message));
      });
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

  function connect() {
    onStatus("connecting");
    socket = new WebSocket(url);

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
      const message = JSON.parse(event.data) as RelayServerMessage;
      if (message.type === "published") {
        const pending = pendingAcks.get(message.envelopeId);
        if (pending) {
          pendingAcks.delete(message.envelopeId);
          window.clearTimeout(pending.timeout);
          pending.resolve();
        }
      } else if (message.type === "error" && pendingAcks.size > 0) {
        rejectPendingAcks(new Error(message.message));
      }
      onMessage(message);
    });
  }

  connect();
  return client;
}

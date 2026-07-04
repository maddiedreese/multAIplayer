import type { RelayClientMessage, RelayServerMessage } from "@multaiplayer/protocol";

export interface RelayClient {
  publish(message: RelayClientMessage): void;
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

  const client: RelayClient = {
    publish(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      } else {
        queue.push(message);
      }
    },
    close() {
      closedByClient = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
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
      if (closedByClient) {
        onStatus("closed");
        return;
      }
      onStatus("closed");
      const delayMs = Math.min(10_000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delayMs);
    });

    socket.addEventListener("error", () => onStatus("error"));
    socket.addEventListener("message", (event) => {
      onMessage(JSON.parse(event.data) as RelayServerMessage);
    });
  }

  connect();
  return client;
}

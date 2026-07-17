import { RelayPublishError } from "./fanout.js";
import { admitRelayWebSocketConnection } from "./connection-admission.js";
import { dispatchRelayClientMessage, isActiveQueuedClientSession } from "./connection-dispatch.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";
import { parseRelayClientMessage } from "./connection-validation.js";
import { RelayStoreByteCapacityError, RelayStoreCapacityError } from "../state.js";

export function registerRelayWebSocketConnection(options: RelayWebSocketConnectionOptions) {
  const { wss, send, sendConnectionError } = options.transport;
  wss.on("connection", (socket, request) => {
    const session = admitRelayWebSocketConnection(options, socket, request);
    if (!session) return;

    let messageChain = Promise.resolve();
    socket.on("message", (raw) => {
      messageChain = messageChain.then(async () => {
        if (!isActiveQueuedClientSession(options, session)) return;
        let publishMessageId: string | undefined;
        try {
          if (options.transport.isReady && !options.transport.isReady()) {
            sendConnectionError(socket, {
              type: "error",
              message: "Relay is not ready. Restart or reconnect before continuing."
            });
            socket.close(1012, "Relay not ready");
            return;
          }
          const rateClientIds = session.rateClientIds ?? [session.rateClientId];
          if (rateClientIds.some((clientId) => !options.rateLimiting.consume("websocket", clientId).allowed)) {
            options.metrics.recordRateLimitRejection?.("websocket");
            sendConnectionError(socket, {
              type: "error",
              message: "Rate limit exceeded. Slow down before sending more room events."
            });
            return;
          }
          options.metrics.recordRateLimitAllowed?.("websocket");
          const parsed = parseRelayClientMessage(options, raw);
          if (parsed.preflightError) {
            sendConnectionError(socket, { type: "error", message: parsed.preflightError });
            return;
          }
          if (!parsed.message) return;
          publishMessageId = parsed.message.type === "publish" ? parsed.message.message.id : undefined;
          await dispatchRelayClientMessage(options, session, parsed.message);
        } catch (error) {
          if (error instanceof RelayStoreCapacityError || error instanceof RelayStoreByteCapacityError) {
            options.metrics.recordCapacityRejection?.(
              error instanceof RelayStoreByteCapacityError ? error.resource : "durable_entries",
              error instanceof RelayStoreByteCapacityError ? error.scope : error.teamId ? "team" : "relay"
            );
          }
          send(socket, relayWebSocketError(error, publishMessageId));
        }
      });
    });

    socket.on("close", () => {
      options.rooms.leaveRoom(session);
      options.rooms.leaveTeams(session);
      options.rooms.leaveWorkspace(session);
      options.state.sessions.delete(socket);
    });
  });
}

export function relayWebSocketError(error: unknown, messageId?: string) {
  return {
    type: "error" as const,
    message:
      error instanceof RelayStoreCapacityError || error instanceof RelayStoreByteCapacityError
        ? "Relay durable capacity is exhausted."
        : error instanceof Error
          ? error.message
          : "Invalid relay message",
    code:
      error instanceof RelayStoreCapacityError || error instanceof RelayStoreByteCapacityError
        ? ("capacity_exceeded" as const)
        : error instanceof RelayPublishError
          ? error.code
          : undefined,
    ...(messageId ? { messageId } : {})
  };
}

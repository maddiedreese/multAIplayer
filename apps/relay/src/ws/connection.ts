import { RelayPublishError } from "./fanout.js";
import { admitRelayWebSocketConnection } from "./connection-admission.js";
import { dispatchRelayClientMessage } from "./connection-dispatch.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";
import { parseRelayClientMessage } from "./connection-validation.js";

export function registerRelayWebSocketConnection(options: RelayWebSocketConnectionOptions) {
  const { wss, send } = options.transport;
  wss.on("connection", (socket, request) => {
    const session = admitRelayWebSocketConnection(options, socket, request);
    if (!session) return;

    let messageChain = Promise.resolve();
    socket.on("message", (raw) => {
      messageChain = messageChain.then(async () => {
        let publishMessageId: string | undefined;
        try {
          if (!options.rateLimiting.consume("websocket", session.rateClientId).allowed) {
            options.metrics.recordRateLimitRejection?.("websocket");
            send(socket, { type: "error", message: "Rate limit exceeded. Slow down before sending more room events." });
            return;
          }
          const parsed = parseRelayClientMessage(options, raw);
          if (parsed.preflightError) {
            send(socket, { type: "error", message: parsed.preflightError });
            return;
          }
          if (!parsed.message) return;
          publishMessageId = parsed.message.type === "publish" ? parsed.message.message.id : undefined;
          await dispatchRelayClientMessage(options, session, parsed.message);
        } catch (error) {
          send(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "Invalid relay message",
            code: error instanceof RelayPublishError ? error.code : undefined,
            messageId: publishMessageId
          });
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

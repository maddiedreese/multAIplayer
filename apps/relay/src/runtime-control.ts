import type { Server } from "node:http";
import { logRelayEvent } from "./observability.js";

export function createRelayRuntimeControl({
  server,
  port,
  flushStore,
  closeStore,
  closeServer,
  shutdown
}: {
  server: Server;
  port: number;
  flushStore: () => Promise<void>;
  closeStore: () => Promise<void>;
  closeServer: () => Promise<void>;
  shutdown: () => Promise<void>;
}) {
  return {
    listen() {
      server.listen(port, () => {
        logRelayEvent("info", "relay_listening", { port });
      });
      return server;
    },
    flushStore,
    closeStore,
    closeServer,
    shutdown
  };
}

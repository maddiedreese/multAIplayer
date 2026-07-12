import type { Server } from "node:http";

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
        console.log(`multAIplayer relay listening on http://127.0.0.1:${port}`);
      });
      return server;
    },
    flushStore,
    closeStore,
    closeServer,
    shutdown
  };
}

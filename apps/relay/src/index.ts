import { closeRelayStore, listenRelayServer } from "./server.js";

listenRelayServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    closeRelayStore()
      .catch((error) => console.error("Failed to save relay store before shutdown:", error))
      .finally(() => process.exit(0));
  });
}

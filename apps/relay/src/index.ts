import { listenRelayServer, shutdownRelay } from "./server.js";

listenRelayServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdownRelay()
      .catch((error) => {
        console.error("Failed to gracefully shut down relay:", error);
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  });
}

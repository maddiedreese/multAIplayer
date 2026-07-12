import { createRelayApp } from "./server.js";

const relay = await createRelayApp();
relay.listen();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    relay
      .shutdown()
      .catch((error) => {
        console.error("Failed to gracefully shut down relay:", error);
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  });
}

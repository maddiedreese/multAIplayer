import { createRelayApp } from "./relay-app.js";
import { logRelayEvent } from "./observability.js";

const relay = await createRelayApp();
relay.listen();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    relay
      .shutdown()
      .catch(() => {
        logRelayEvent("error", "relay_shutdown_failed");
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  });
}

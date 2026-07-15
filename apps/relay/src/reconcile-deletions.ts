import { createRelayApp } from "./relay-app.js";

const relay = await createRelayApp();
try {
  process.stdout.write(`${JSON.stringify({ ok: true, ...relay.deletionReconciliation })}\n`);
} finally {
  await relay.closeStore();
}

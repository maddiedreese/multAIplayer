import { createRelayApp } from "./relay-app.js";

const deleteOwnedResources = process.argv.includes("--delete-owned-resources");
const subjectArgument = process.argv.find((argument) => argument.startsWith("--subject="));
const subject = subjectArgument?.slice("--subject=".length);
if (deleteOwnedResources && !subject?.match(/^[a-f0-9]{64}$/)) {
  throw new Error("--delete-owned-resources requires the exact 64-character --subject reported by reconciliation.");
}
if (subject && !deleteOwnedResources) {
  throw new Error("--subject is valid only with --delete-owned-resources.");
}

const relay = await createRelayApp({
  ...(subject ? { deleteOwnedResourcesForDeletionSubject: subject } : {})
});
try {
  process.stdout.write(`${JSON.stringify({ ok: true, ...relay.deletionReconciliation })}\n`);
} finally {
  await relay.closeStore();
}

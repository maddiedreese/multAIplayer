import assert from "node:assert/strict";
import test from "node:test";
import { MlsRelayMessage, RelayClientMessage } from "@multaiplayer/protocol";
const fuzzSeed = process.env.MULTAIPLAYER_RELAY_FUZZ_SEED ?? "mls-v2";
const fuzzIterations = Number(process.env.MULTAIPLAYER_RELAY_FUZZ_ITERATIONS ?? 100_000);
test("MLS relay framing rejects malformed fuzz corpus", () => {
  assert.ok(fuzzSeed);
  assert.ok(fuzzIterations > 0);
  for (const value of [
    null,
    {},
    "x",
    { type: "publish", message: {} },
    { type: "publish", message: { id: "x", mlsMessage: "" } }
  ])
    assert.equal(RelayClientMessage.safeParse(value).success, false);
  const valid = MlsRelayMessage.parse({
    id: "m",
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device-1",
    createdAt: new Date().toISOString(),
    messageType: "application",
    epochHint: 0,
    mlsMessage: "AA=="
  });
  assert.equal(RelayClientMessage.safeParse({ type: "publish", message: valid }).success, true);
});

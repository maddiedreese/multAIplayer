import assert from "node:assert/strict";
import test from "node:test";
import { MlsRelayMessage, RelayClientMessage, pinnedMlsCiphersuite } from "../src/index.js";
test("v2 publish messages round trip", () => {
  const message = MlsRelayMessage.parse({
    id: "x",
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device-1",
    createdAt: new Date().toISOString(),
    messageType: "commit",
    epochHint: 0,
    mlsMessage: "AA=="
  });
  assert.deepEqual(RelayClientMessage.parse({ type: "publish", message }), { type: "publish", message });
});
test("suite is pinned", () => assert.equal(pinnedMlsCiphersuite, 2));

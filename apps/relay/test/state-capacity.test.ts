import assert from "node:assert/strict";
import test from "node:test";
import { createRelayStore, RelayStoreCapacityError } from "../src/state.js";

test("durable relay state fails loudly at its configured entry ceiling", () => {
  const store = createRelayStore(2);
  store.invites.set("invite-a", {} as never);
  store.rooms.set("room-a", {} as never);

  assert.throws(() => store.devices.set("user:device", {} as never), RelayStoreCapacityError);

  store.invites.delete("invite-a");
  assert.doesNotThrow(() => store.devices.set("user:device", {} as never));
});

test("replacing durable entries does not consume additional capacity", () => {
  const store = createRelayStore(1);
  store.invites.set("invite-a", {} as never);
  assert.doesNotThrow(() => store.invites.set("invite-a", { replacement: true } as never));
});

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

test("one team's durable-entry ceiling preserves global capacity for another team", () => {
  const store = createRelayStore(100, 3);
  store.setTeam({ id: "team-a", name: "A", members: 1 });
  store.setTeamMembers(
    "team-a",
    new Map([["user-a", { teamId: "team-a", userId: "user-a", role: "owner", joinedAt: new Date().toISOString() }]])
  );

  assert.throws(
    () => store.setRoom({ id: "room-a", teamId: "team-a" } as never),
    (error: unknown) => error instanceof RelayStoreCapacityError && error.teamId === "team-a"
  );
  assert.doesNotThrow(() => store.setTeam({ id: "team-b", name: "B", members: 0 }));
});

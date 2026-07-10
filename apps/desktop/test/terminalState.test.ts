import assert from "node:assert/strict";
import test from "node:test";
import { replaceRoomTerminalSnapshots } from "../src/lib/terminalState";

const alphaTerminal = { id: "alpha:dev", roomId: "alpha", name: "dev", running: true };
const betaTerminal = { id: "beta:dev", roomId: "beta", name: "dev", running: true };

test("replaceRoomTerminalSnapshots updates only one room", () => {
  const next = replaceRoomTerminalSnapshots([alphaTerminal, betaTerminal], "alpha", [
    { id: "alpha:test", roomId: "alpha", name: "test", running: false }
  ]);

  assert.deepEqual(
    next.map((terminal) => terminal.id),
    ["alpha:test", "beta:dev"]
  );
  assert.equal(next.find((terminal) => terminal.id === "beta:dev")?.running, true);
});

test("replaceRoomTerminalSnapshots clears one room while preserving others", () => {
  const next = replaceRoomTerminalSnapshots([alphaTerminal, betaTerminal], "alpha", []);

  assert.deepEqual(next, [betaTerminal]);
});

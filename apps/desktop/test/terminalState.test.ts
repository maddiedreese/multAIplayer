import assert from "node:assert/strict";
import test from "node:test";
import { terminalsForLocalHistory, replaceRoomTerminalSnapshots } from "../src/lib/terminal/terminalState";

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

test("terminal history drops interactive input while retaining process output", () => {
  const [terminal] = terminalsForLocalHistory([
    {
      ...alphaTerminal,
      displayRevision: 1,
      displayChunks: [{ revision: 1, text: "ghp_live_screen_secret" }],
      lines: [
        { stream: "stdout", text: "Password: " },
        { stream: "stdin", text: "ghp_attacker_shaped_secret" },
        { stream: "system", text: "done" }
      ]
    }
  ]);

  assert.equal(terminal?.running, false);
  assert.equal(terminal?.displayRevision, undefined);
  assert.equal(terminal?.displayChunks, undefined);
  assert.deepEqual(terminal?.lines, [
    { stream: "stdout", text: "Password: " },
    { stream: "system", text: "done" }
  ]);
});

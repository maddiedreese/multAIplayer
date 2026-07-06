import assert from "node:assert/strict";
import { test } from "node:test";
import { nextShellTerminalName, terminalInputForShellSubmit } from "../src/lib/terminalUi";

test("nextShellTerminalName uses shell for the first terminal", () => {
  assert.equal(nextShellTerminalName([]), "shell");
});

test("nextShellTerminalName increments from existing shell sessions", () => {
  assert.equal(
    nextShellTerminalName([{ name: "shell" }, { name: "shell 2" }, { name: "tests" }]),
    "shell 3"
  );
});

test("terminalInputForShellSubmit sends enter to the PTY", () => {
  assert.equal(terminalInputForShellSubmit("git status"), "git status\n");
  assert.equal(terminalInputForShellSubmit("git status\n"), "git status\n");
  assert.equal(terminalInputForShellSubmit("   "), null);
});

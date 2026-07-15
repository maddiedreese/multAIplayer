import assert from "node:assert/strict";
import { test } from "node:test";
import { nextShellTerminalName } from "../src/lib/terminal/terminalUi";

test("nextShellTerminalName uses shell for the first terminal", () => {
  assert.equal(nextShellTerminalName([]), "shell");
});

test("nextShellTerminalName increments from existing shell sessions", () => {
  assert.equal(nextShellTerminalName([{ name: "shell" }, { name: "shell-2" }, { name: "tests" }]), "shell-3");
});

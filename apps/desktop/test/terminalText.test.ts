import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalControlSequences } from "../src/lib/terminalText";

test("stripTerminalControlSequences removes ANSI and bracketed paste controls", () => {
  assert.equal(
    stripTerminalControlSequences("\u001b[?2004hMaddies-MacBook-Pro%\u001b[?2004l"),
    "Maddies-MacBook-Pro%"
  );
  assert.equal(stripTerminalControlSequences("\uFFFD[?2004hhi\uFFFD[?2004l"), "hi");
  assert.equal(stripTerminalControlSequences("\u001b[38;2;124;77;255mhi\u001b[0m"), "hi");
});

import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "../src/lib/clipboard";

test("copyTextToClipboard reports successful writes", async () => {
  let copied = "";
  const result = await copyTextToClipboard("hello", {
    writeText: async (value: string) => {
      copied = value;
    }
  } as Clipboard);

  assert.deepEqual(result, { status: "copied" });
  assert.equal(copied, "hello");
});

test("copyTextToClipboard reports unavailable clipboard", async () => {
  const result = await copyTextToClipboard("hello", undefined);

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /unavailable/);
});

test("copyTextToClipboard reports blocked writes", async () => {
  const result = await copyTextToClipboard("hello", {
    writeText: async () => {
      throw new Error("document is not focused");
    }
  } as unknown as Clipboard);

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /not focused/);
});

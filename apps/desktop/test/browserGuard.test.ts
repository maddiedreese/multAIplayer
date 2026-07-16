import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const guardSource = await readFile(
  fileURLToPath(new URL("../src-tauri/src/browser_guard.js", import.meta.url)),
  "utf8"
);

function guardedDocument() {
  return new JSDOM('<!doctype html><input id="upload" type="file">', {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          read: async () => [],
          readText: async () => "secret",
          write: async () => undefined,
          writeText: async () => undefined
        }
      });
    }
  });
}

test("room browser guard replaces every page clipboard operation", async () => {
  const dom = guardedDocument();
  dom.window.eval(guardSource);

  for (const operation of ["read", "readText", "write", "writeText"] as const) {
    await assert.rejects(dom.window.navigator.clipboard[operation](), (error: unknown) => {
      return error instanceof dom.window.DOMException && error.name === "NotAllowedError";
    });
  }
});

test("room browser guard cancels file input, drag, and drop events", () => {
  const dom = guardedDocument();
  dom.window.eval(guardSource);
  const input = dom.window.document.querySelector<HTMLInputElement>("#upload");
  assert.ok(input);

  const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
  assert.equal(input.dispatchEvent(click), false);
  assert.equal(click.defaultPrevented, true);

  for (const name of ["change", "dragover", "drop"] as const) {
    const target = name === "change" ? input : dom.window;
    const event = new dom.window.Event(name, { bubbles: true, cancelable: true });
    assert.equal(target.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { Browser } from "webdriverio";
import { selectRoom } from "./invite-scenarios.js";

test("room selection accepts an active room that hydrates after the initial probe", async () => {
  const dom = new JSDOM('<input aria-label="Room title" value="">');
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  let sidebarLookups = 0;

  const browser = {
    execute: async (script: (expected: string) => unknown, expected: string) => script(expected),
    waitUntil: async (predicate: () => Promise<boolean>) => {
      assert.equal(await predicate(), false);
      const title = document.querySelector<HTMLInputElement>('input[aria-label="Room title"]');
      assert.ok(title);
      title.value = "Recovered room";
      assert.equal(await predicate(), true);
    },
    $: async () => {
      sidebarLookups += 1;
      throw new Error("the selected recovery room should not require a sidebar row");
    }
  } as unknown as Browser;

  try {
    await selectRoom(browser, "Recovered room");
    assert.equal(sidebarLookups, 0);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    dom.window.close();
  }
});

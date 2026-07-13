import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { createElement } from "react";

if (!process.env.MULTAIPLAYER_SMOKE_WATCHDOG) {
  throw new Error("App smoke must run through the desktop smoke-test script.");
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  React,
  Element: dom.window.Element,
  Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

const { cleanup, render, screen } = await import("@testing-library/react");
const { App } = await import("../src/App");

afterEach(() => cleanup());

test("browser preview is a seeded local demo with native MLS actions disabled", () => {
  render(createElement(App));
  assert.ok(screen.getByTestId("web-preview-demo"));
  assert.equal(screen.getAllByText("Welcome room").length, 2);
  assert.match(
    screen.getByRole("status").textContent ?? "",
    /End-to-end encrypted rooms require the native desktop app/
  );
  assert.equal((screen.getByRole("button", { name: "New encrypted room" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Join with invite" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByLabelText("Demo message composer") as HTMLTextAreaElement).disabled, true);
});

test("browser preview exposes no relay or private MLS material", () => {
  render(createElement(App));
  assert.match(screen.getByText(/This browser preview cannot create/).textContent ?? "", /no device identity/);
  assert.equal(document.querySelector("[data-relay-room]"), null);
  assert.equal(localStorage.length, 0);
});

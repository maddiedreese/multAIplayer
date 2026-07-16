import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { createElement } from "react";

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

test("browser build directs users to the native product without rendering a workspace", () => {
  render(createElement(App));
  assert.ok(screen.getByTestId("native-app-required"));
  assert.match(screen.getByRole("heading").textContent ?? "", /Apple silicon Macs/);
  assert.equal(screen.queryByRole("button"), null);
  assert.equal(
    screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    "https://multaiplayer.com/privacy"
  );
  assert.equal(
    screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href"),
    "https://multaiplayer.com/terms"
  );
});

test("browser build exposes no room, relay, or private MLS material", () => {
  render(createElement(App));
  assert.match(
    screen.getByText(/This browser page does not contain a workspace/).textContent ?? "",
    /supported signed alpha/
  );
  assert.equal(document.querySelector("[data-relay-room]"), null);
  assert.equal(localStorage.length, 0);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { HelpDrawerPanel } from "../src/components/HelpDrawerPanel";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  React
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

afterEach(() => cleanup());

test("help exposes an explicit privacy-preserving bug report path", () => {
  const view = render(
    <HelpDrawerPanel
      completedSteps={0}
      totalSteps={3}
      onOpenSetupGuide={() => undefined}
      onShowSetupChecklist={() => undefined}
      onRestartSetupGuide={() => undefined}
    />
  );

  const link = view.getByRole("link", { name: /Report a bug/ });
  assert.match(link.getAttribute("href") ?? "", /bug_report\.yml/);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(view.container.textContent ?? "", /Nothing is uploaded automatically/);
  assert.match(view.container.textContent ?? "", /never include room content/);
});

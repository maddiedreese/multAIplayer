import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { AppErrorBoundary } from "../src/components/AppErrorBoundary";
import { clearDiagnosticEntries, loadDiagnosticEntries } from "../src/lib/platform/diagnostics";

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

function FailedView(): React.ReactNode {
  throw new Error("test renderer failure");
}

afterEach(() => {
  cleanup();
  clearDiagnosticEntries();
});

test("unexpected renderer failures show recovery UI and enter redacted diagnostics", () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const view = render(
      <AppErrorBoundary>
        <FailedView />
      </AppErrorBoundary>
    );
    assert.ok(view.getByTestId("app-recovery-surface"));
    assert.match(view.getByRole("heading").textContent ?? "", /stopped unexpectedly/);
    assert.equal(view.getByRole("button", { name: "Reload interface" }).getAttribute("type"), "button");
    assert.match(view.getByRole("link", { name: "Report this bug" }).getAttribute("href") ?? "", /bug_report\.yml/);
    assert.match(view.getByTestId("app-recovery-surface").textContent ?? "", /Nothing is uploaded automatically/);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(
    loadDiagnosticEntries().map(({ level, message }) => ({ level, message })),
    [{ level: "error", message: "React render failure" }]
  );
});

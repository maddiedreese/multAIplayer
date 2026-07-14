import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { RoomChatComposer } from "../src/components/RoomChatComposer";
import { loadCodexFollowUpBehavior } from "../src/lib/codexFollowUpBehavior";

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
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function composer(overrides: { codexRunning?: boolean; isActiveHost?: boolean } = {}) {
  return createElement(RoomChatComposer, {
    roomGoal: null,
    codexRunning: overrides.codexRunning ?? false,
    isActiveHost: overrides.isActiveHost ?? true,
    pendingAttachments: [],
    pendingAttachmentSummary: "0/5 files",
    replyTarget: null,
    roomLocked: false,
    lockedPlaceholder: "Room locked",
    chatEnabled: true,
    canUseChat: true,
    canSendMessage: false,
    draft: "",
    onPauseGoal: () => undefined,
    onResumeGoal: () => undefined,
    onEditGoal: () => undefined,
    onDeleteGoal: () => undefined,
    onInvokeCodex: () => undefined,
    onOpenFileSelector: () => undefined,
    onRemovePendingAttachment: () => undefined,
    onCancelReply: () => undefined,
    onDraftChange: () => undefined,
    onSendMessage: () => undefined
  });
}

test("running active hosts can choose and persist steer or queue behavior", () => {
  const view = render(composer({ codexRunning: true, isActiveHost: true }));
  const selector = view.getByRole("combobox", { name: "Codex follow-up behavior" }) as HTMLSelectElement;
  assert.equal(selector.value, "steer");
  assert.deepEqual(
    Array.from(selector.options).map((option) => option.text),
    ["Steer current turn", "Queue next turn"]
  );

  fireEvent.change(selector, { target: { value: "queue" } });
  assert.equal(selector.value, "queue");
  assert.equal(loadCodexFollowUpBehavior(), "queue");

  view.unmount();
  const resumed = render(composer({ codexRunning: true, isActiveHost: true }));
  assert.equal(
    (resumed.getByRole("combobox", { name: "Codex follow-up behavior" }) as HTMLSelectElement).value,
    "queue"
  );
});

test("follow-up selector is hidden without both an active turn and host authority", () => {
  const idle = render(composer({ codexRunning: false, isActiveHost: true }));
  assert.equal(idle.queryByRole("combobox", { name: "Codex follow-up behavior" }), null);
  idle.unmount();

  const member = render(composer({ codexRunning: true, isActiveHost: false }));
  assert.equal(member.queryByRole("combobox", { name: "Codex follow-up behavior" }), null);
});

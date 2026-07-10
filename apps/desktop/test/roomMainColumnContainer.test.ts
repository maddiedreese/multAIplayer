import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import React, { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import {
  RoomMainColumnContainer,
  type RoomMainColumnCapabilities,
  type RoomMainColumnSources
} from "../src/components/RoomMainColumnContainer";
import { useAppStore } from "../src/store/appStore";
import { seededRooms, seededTeams } from "../src/seedData";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  React
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

const noop = () => undefined;
const capabilities = {
  header: {
    onSetHost: noop,
    onRenameRoom: noop,
    onSelectModel: noop,
    onSelectReasoningEffort: noop,
    onSelectSpeed: noop,
    onCopyRoomMarkdown: noop,
    onCopySelectedMarkdown: noop,
    onShareLocalPreview: noop,
    onOpenRoomBrowser: noop
  },
  chat: {
    onCopyMessageMarkdown: noop,
    onCopyCodexOutputMarkdown: noop,
    onOpenAttachment: noop,
    onToggleReaction: noop,
    onEditMessage: noop,
    onDeleteMessage: noop,
    onDenyApproval: noop,
    onApproveApproval: noop,
    onInvokeCodex: noop,
    onRemovePendingAttachment: noop,
    onPauseGoal: noop,
    onResumeGoal: noop,
    onEditGoal: noop,
    onDeleteGoal: noop,
    onTickGoalElapsed: noop,
    onOpenLocalPreview: noop,
    onCopyLocalPreviewLink: noop,
    onStopLocalPreview: noop,
    onCancelQueuedCodexTurn: noop,
    onSendMessage: noop
  },
  retryMarkdownCopy: noop
} as RoomMainColumnCapabilities;
const sources = {
  roomRuntime: {
    renameRoom: capabilities.header.onRenameRoom,
    setCodexModel: capabilities.header.onSelectModel,
    setCodexReasoningEffort: capabilities.header.onSelectReasoningEffort,
    setCodexSpeed: capabilities.header.onSelectSpeed,
    openLocalPreviewDialog: capabilities.header.onShareLocalPreview,
    openRoomBrowserNow: capabilities.header.onOpenRoomBrowser,
    sendMessage: capabilities.chat.onSendMessage
  },
  workspaceFlow: {
    copyRoomMarkdown: capabilities.header.onCopyRoomMarkdown,
    copySelectedMessagesMarkdown: capabilities.header.onCopySelectedMarkdown,
    removePendingAttachment: capabilities.chat.onRemovePendingAttachment,
    copyMarkdownWithFallback: noop
  },
  hostHandoff: { setRoomHost: capabilities.header.onSetHost },
  chatActions: capabilities.chat
} as unknown as RoomMainColumnSources;

beforeEach(() => {
  const store = useAppStore.getState();
  store.resetAppStore();
  store.initializeWorkspaceUi({
    teams: seededTeams,
    rooms: seededRooms,
    projectPath: seededRooms[0]?.projectPath ?? "",
    roomId: seededRooms[0]?.id ?? ""
  });
  localStorage.clear();
});

afterEach(() => cleanup());

test("main-column container reads and mutates selected-room state at its component boundary", () => {
  const view = render(createElement(RoomMainColumnContainer, { sources }));

  const selectedRoom = seededRooms[0];
  assert.ok(selectedRoom);
  assert.equal((view.getByLabelText("Room title") as HTMLInputElement).value, selectedRoom.name);

  fireEvent.click(view.getByText("Selected"));
  assert.equal(useAppStore.getState().roomChatByRoom[selectedRoom.id]?.markdownSelectionMode, true);

  fireEvent.click(view.getByText("terminal"));
  assert.equal(useAppStore.getState().historyPresenceByRoom[selectedRoom.id]?.inspectorTab, "terminal");
});

test("main-column container projects lock state without parent view-model wiring", () => {
  const selectedRoom = seededRooms[0];
  assert.ok(selectedRoom);
  useAppStore.getState().rememberForgottenRoom(selectedRoom.id);

  const view = render(createElement(RoomMainColumnContainer, { sources }));

  assert.match(view.getByText(/forgotten|locked|access/i).textContent ?? "", /forgotten|locked|access/i);
  assert.equal((view.container.querySelector("textarea") as HTMLTextAreaElement).disabled, true);
});

test("selected-room store updates preserve effectful capability identity", () => {
  const selectedRoom = seededRooms[0];
  assert.ok(selectedRoom);
  useAppStore.getState().setRoomGoalForRoom(selectedRoom.id, {
    id: "goal-identity",
    text: "Keep the timer stable",
    status: "active",
    startedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    elapsedMs: 0
  });
  const originalSetInterval = window.setInterval;
  let intervalStarts = 0;
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    intervalStarts += 1;
    return originalSetInterval(handler, timeout, ...args);
  }) as typeof window.setInterval;

  try {
    render(createElement(RoomMainColumnContainer, { sources }));
    assert.equal(intervalStarts, 1);

    act(() => useAppStore.getState().setDraftForRoom(selectedRoom.id, "rerender without restarting effects"));

    assert.equal(intervalStarts, 1);
  } finally {
    window.setInterval = originalSetInterval;
  }
});

import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { createElement } from "react";
import { useAppStore } from "../src/store/appStore";
import { initialMessagesByRoom, seededRooms } from "../src/seedData";

if (!process.env.MULTAIPLAYER_SMOKE_WATCHDOG) {
  throw new Error("App smoke must run through `npm run test:smoke -w @multaiplayer/desktop` so the external timeout and single-instance lock are active.");
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: dom.window
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: dom.window.document
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: dom.window.localStorage
});

Object.assign(globalThis, {
  React,
  Element: dom.window.Element,
  Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  MouseEvent: dom.window.MouseEvent,
  PointerEvent: dom.window.PointerEvent ?? dom.window.MouseEvent
});

dom.window.matchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false
});
dom.window.confirm = () => true;
dom.window.open = () => null;

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = TestWebSocket.CONNECTING;
  sentMessages: string[] = [];
  private static readonly instances = new Set<TestWebSocket>();
  private readonly listeners = new Map<string, Array<(event: MessageEvent | Event) => void>>();
  private openTimer: ReturnType<typeof setTimeout> | null;

  constructor(url: string) {
    this.url = url;
    TestWebSocket.instances.add(this);
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      this.readyState = TestWebSocket.OPEN;
      this.dispatch("open", new Event("open"));
    }, 0);
  }

  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((current) => current !== listener));
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    if (this.readyState === TestWebSocket.CLOSED) return;
    if (this.openTimer !== null) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this.readyState = TestWebSocket.CLOSED;
    this.dispatch("close", new Event("close"));
    this.listeners.clear();
    TestWebSocket.instances.delete(this);
  }

  static closeAll() {
    for (const socket of [...TestWebSocket.instances]) socket.close();
  }

  private dispatch(type: string, event: MessageEvent | Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: TestWebSocket
});
Object.defineProperty(dom.window, "WebSocket", {
  configurable: true,
  value: TestWebSocket
});

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/auth/config")) {
      return jsonResponse({
        provider: "github",
        configured: false,
        scopes: ["read:user"],
        mutationsRequireAuth: false,
        allowedOrigins: [],
        sessionPersistence: "memory_only"
      });
    }
    if (url.endsWith("/auth/me")) {
      return jsonResponse({ error: "Not signed in" }, { status: 401 });
    }
    const settingsMatch = url.match(/\/rooms\/([^/]+)\/settings$/);
    if (settingsMatch && init?.method === "PATCH") {
      const roomId = decodeURIComponent(settingsMatch[1]);
      const room = seededRooms.find((item) => item.id === roomId);
      if (!room) return jsonResponse({ error: "Room not found" }, { status: 404 });
      const patch = JSON.parse(String(init.body ?? "{}"));
      return jsonResponse({ room: { ...room, ...patch } });
    }
    throw new Error(`Network disabled in App smoke test: ${url}`);
  }
});

function resetAppSmokeDom() {
  cleanup();
  useAppStore.getState().resetAppStore();
  useAppStore.getState().seedWorkspaceInitialDataIfEmpty({
    teamMembersByTeam: {},
    messagesByRoom: structuredClone(initialMessagesByRoom)
  });
  localStorage.clear();
  document.body.innerHTML = "";
}

afterEach(() => {
  cleanup();
  TestWebSocket.closeAll();
  useAppStore.getState().resetAppStore();
  localStorage.clear();
  document.body.innerHTML = "";
});

after(() => {
  cleanup();
  TestWebSocket.closeAll();
  dom.window.close();
});

const { cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const appModule = await import("../src/App");
const App = appModule.App;

test("App smoke", { timeout: 25_000 }, async (t) => {
  await t.test("renders seeded room and switches rooms", { timeout: 5_000 }, async () => {
    resetAppSmokeDom();
    render(createElement(App));

    await waitFor(() => {
      assert.ok(screen.getAllByText("Desktop app").length > 0);
    });
    assert.match(screen.getByText("We need to capture onboarding progress and improve the stepper.").textContent ?? "", /onboarding/);

    fireEvent.click(screen.getByText("Relay ops"));

    await waitFor(() => {
      assert.ok(screen.getAllByText("Relay ops").length > 0);
    });
    assert.equal(screen.getByText("No visible rooms.").textContent, "No visible rooms.");
  });

  await t.test("invoking Codex shows host approval context", { timeout: 5_000 }, async () => {
    resetAppSmokeDom();
    render(createElement(App));

    fireEvent.click(await screen.findByLabelText("Invoke Codex"));

    const approval = await screen.findByText("Approve Codex turn");
    assert.equal(approval.textContent, "Approve Codex turn");
    const approvalCard = approval.closest(".approval-card");
    assert.ok(approvalCard);
    assert.ok(within(approvalCard as HTMLElement).getByText("Messages"));
    assert.ok(within(approvalCard as HTMLElement).getByText("No new messages."));
  });

  await t.test("sends a normal room message", { timeout: 5_000 }, async () => {
    resetAppSmokeDom();
    render(createElement(App));

    const composer = await screen.findByPlaceholderText(/Message the room/);
    fireEvent.change(composer, { target: { value: "Can everyone see this?" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      assert.equal(screen.getByText("Can everyone see this?").textContent, "Can everyone see this?");
    });
  });

  await t.test("wires header model, reasoning, and speed selectors to room settings", { timeout: 5_000 }, async () => {
    resetAppSmokeDom();
    render(createElement(App));

    const modelSelect = await screen.findByLabelText("Codex host model") as HTMLSelectElement;
    const reasoningSelect = screen.getByLabelText("Codex reasoning") as HTMLSelectElement;
    const speedSelect = screen.getByLabelText("Codex speed") as HTMLSelectElement;
    const modelOptions = Array.from(modelSelect.options).map((option) => option.value);
    const reasoningOptions = Array.from(reasoningSelect.options).map((option) => option.value);
    const speedOptions = Array.from(speedSelect.options).map((option) => option.value);

    assert.deepEqual(modelOptions, ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-cyber", "gpt-5.3-codex", "gpt-5.3-codex-spark"]);
    assert.deepEqual(reasoningOptions, ["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(speedOptions, ["standard", "fast"]);

    fireEvent.change(modelSelect, { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => {
      assert.equal(modelSelect.value, "gpt-5.6-luna");
    });
    await waitFor(() => {
      assert.equal(reasoningSelect.disabled, false);
    });

    fireEvent.change(reasoningSelect, { target: { value: "max" } });
    await waitFor(() => {
      assert.equal(reasoningSelect.value, "max");
    });
    await waitFor(() => {
      assert.equal(speedSelect.disabled, false);
    });

    fireEvent.change(speedSelect, { target: { value: "fast" } });
    await waitFor(() => {
      assert.equal(speedSelect.value, "fast");
    });
  });

  await t.test("switches inspector tabs after browser and files without blanking the rail", { timeout: 5_000 }, async () => {
    resetAppSmokeDom();
    render(createElement(App));
    const roomTools = await screen.findByRole("navigation", { name: "Room tools" });

    fireEvent.click(within(roomTools).getByRole("button", { name: /browser/i }));
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Browser URL"));
    });

    fireEvent.click(within(roomTools).getByRole("button", { name: /terminal/i }));
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: /New terminal/i }));
    });
    assert.equal(document.querySelector(".browser-panel"), null);
    assert.equal(document.querySelector(".inspector-panel-terminal"), document.querySelector("[data-active-tab='terminal']"));

    fireEvent.click(within(roomTools).getByRole("button", { name: /browser/i }));
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Browser URL"));
    });

    fireEvent.click(within(roomTools).getByRole("button", { name: /room/i }));
    await waitFor(() => {
      assert.ok(screen.getByText("Team roster"));
    });
    assert.equal(document.querySelector(".browser-panel"), null);
    assert.equal(document.querySelector("[data-active-tab='room']")?.textContent?.includes("Team roster"), true);

    fireEvent.click(within(roomTools).getByRole("button", { name: /files/i }));
    await waitFor(() => {
      assert.ok(screen.getByPlaceholderText("Search project files"));
      assert.ok(screen.getByText("Changed files"));
    });

    fireEvent.click(within(roomTools).getByRole("button", { name: /room/i }));
    await waitFor(() => {
      assert.ok(screen.getByText("Team roster"));
    });
    assert.equal(document.querySelector(".browser-panel"), null);

    fireEvent.click(within(roomTools).getByRole("button", { name: /terminal/i }));
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: /New terminal/i }));
    });
    assert.equal(document.querySelector("[data-active-tab='terminal']")?.textContent?.includes("New terminal"), true);
  });
});

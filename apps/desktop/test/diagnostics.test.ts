import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { JSDOM } from "jsdom";
import {
  buildDiagnosticBundle,
  clearDiagnosticEntries,
  loadDiagnosticEntries,
  recordDiagnosticEvent
} from "../src/lib/diagnostics";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: dom.window
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: dom.window.localStorage
});

beforeEach(() => {
  clearMocks();
  localStorage.clear();
  clearDiagnosticEntries();
});

test("recordDiagnosticEvent stores bounded redacted diagnostics", () => {
  recordDiagnosticEvent(
    "error",
    "Failed request",
    "https://relay.example.com/invites?token=abc",
    "gho_abcdefghijklmnopqrstuvwxyz1234567890"
  );
  const entries = loadDiagnosticEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "error");
  assert.match(entries[0].detail ?? "", /https:\/\/relay\.example\.com\/invites/);
  assert.doesNotMatch(entries[0].detail ?? "", /token=abc/);
  assert.doesNotMatch(entries[0].detail ?? "", /gho_/);
});

test("web-preview diagnostics remain memory-only", () => {
  recordDiagnosticEvent("warn", "Memory only");
  assert.equal(localStorage.length, 0);
  assert.equal(loadDiagnosticEntries().length, 1);
});

test("Tauri diagnostics persist exactly one redacted entry", async () => {
  const calls: Array<{ command: string; payload: Record<string, unknown> | undefined }> = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
  });

  recordDiagnosticEvent("warn", "Persistence test", { secret: "short-secret", safe: "visible" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "record_diagnostic");
  const entry = calls[0].payload?.entry as Record<string, unknown>;
  assert.equal(entry.level, "warn");
  assert.match(String(entry.detail), /"secret":"\[omitted\]"/);
  assert.match(String(entry.detail), /"safe":"visible"/);
});

test("failed Tauri persistence is swallowed without changing the memory ring", async () => {
  let calls = 0;
  mockIPC((command) => {
    if (command === "record_diagnostic") {
      calls += 1;
      return Promise.reject(new Error("write failed"));
    }
  });

  recordDiagnosticEvent("error", "Persistence failure");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 1);
  assert.equal(loadDiagnosticEntries().length, 1);
});

test("Tauri persistence is serialized and export waits for pending writes", async () => {
  const commands: string[] = [];
  let finishFirstWrite: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => {
    finishFirstWrite = resolve;
  });
  mockIPC((command) => {
    commands.push(command);
    if (command === "record_diagnostic" && commands.filter((value) => value === command).length === 1) {
      return firstWrite;
    }
    if (command === "export_diagnostic_entries") return [];
  });

  recordDiagnosticEvent("warn", "First write");
  recordDiagnosticEvent("warn", "Second write");
  const bundlePromise = buildDiagnosticBundle();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(commands, ["record_diagnostic"]);
  finishFirstWrite?.();
  await bundlePromise;
  assert.deepEqual(commands, ["record_diagnostic", "record_diagnostic", "export_diagnostic_entries"]);
});

test("object diagnostics deeply omit sensitive keys without executing object hooks", () => {
  let getterCalls = 0;
  let toJsonCalls = 0;
  let toStringCalls = 0;
  const circular: Record<string, unknown> = {
    body: "chat plaintext",
    nested: {
      ACCESS_TOKEN: "short-token",
      access_token: "another-short-token",
      harmless: "kept"
    },
    array: [{ passphrase: "words", value: 7 }],
    toJSON() {
      toJsonCalls += 1;
      return { plaintext: "leaked" };
    },
    toString() {
      toStringCalls += 1;
      return "leaked";
    }
  };
  Object.defineProperty(circular, "dangerous", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "leaked";
    }
  });
  circular.self = circular;

  recordDiagnosticEvent("error", "Serialization safety", circular);

  const detail = loadDiagnosticEntries()[0].detail ?? "";
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
  assert.equal(toStringCalls, 0);
  assert.doesNotMatch(detail, /chat plaintext|short-token|another-short-token|words|leaked/);
  assert.match(detail, /"body":"\[omitted\]"/);
  assert.match(detail, /"ACCESS_TOKEN":"\[omitted\]"/);
  assert.match(detail, /"access_token":"\[omitted\]"/);
  assert.match(detail, /"passphrase":"\[omitted\]"/);
  assert.match(detail, /"harmless":"kept"/);
  assert.match(detail, /"dangerous":"\[unavailable\]"/);
  assert.match(detail, /"self":"\[circular\]"/);
});

test("object diagnostics bound depth, arrays, keys, and final detail length", () => {
  let deep: Record<string, unknown> = { tail: "unreachable" };
  for (let index = 0; index < 10; index += 1) deep = { nested: deep };
  const manyKeys = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field${index}`, index]));
  recordDiagnosticEvent("warn", "Bounds", {
    deep,
    items: Array.from({ length: 60 }, (_, index) => index),
    manyKeys,
    large: "x".repeat(1_000)
  });

  const detail = loadDiagnosticEntries()[0].detail ?? "";
  assert.ok(detail.length <= 800);
  assert.match(detail, /\[max-depth\]/);
  assert.match(detail, /\[truncated\]/);
});

test("Error diagnostics use only data name and message fields", () => {
  let getterCalls = 0;
  const error = new Error("safe failure");
  Object.defineProperty(error, "cause", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { plaintext: "leaked" };
    }
  });
  Object.defineProperty(error, "secret", { enumerable: true, value: "leaked-secret" });

  recordDiagnosticEvent("error", "Error formatting", error);

  assert.equal(getterCalls, 0);
  assert.equal(loadDiagnosticEntries()[0].detail, "Error: safe failure");
});

test("diagnostic memory ring retains only the newest 80 entries", () => {
  for (let index = 0; index < 85; index += 1) recordDiagnosticEvent("warn", `Event ${index}`);
  const entries = loadDiagnosticEntries();
  assert.equal(entries.length, 80);
  assert.equal(entries[0].message, "Event 5");
  assert.equal(entries[79].message, "Event 84");
});

test("buildDiagnosticBundle includes app metadata and relay origins only", async () => {
  localStorage.setItem("multaiplayer:app-config", JSON.stringify({
    relayHttpUrl: "https://relay.example.com/api?secret=1",
    relayWsUrl: "wss://relay.example.com/rooms?secret=1"
  }));
  recordDiagnosticEvent("warn", "Something happened");
  const bundle = await buildDiagnosticBundle(new Date("2026-07-08T00:00:00.000Z"));
  assert.match(bundle, /"version": "0\.1\.0-alpha\.0"/);
  assert.match(bundle, /"httpOrigin": "https:\/\/relay\.example\.com"/);
  assert.match(bundle, /"wsOrigin": "wss:\/\/relay\.example\.com"/);
  assert.doesNotMatch(bundle, /secret=1/);
});

test("Tauri bundle export merges, deduplicates, validates, and re-redacts persisted entries", async () => {
  let recordedEntry: unknown;
  mockIPC((command, payload) => {
    if (command === "record_diagnostic") {
      recordedEntry = payload?.entry;
      return;
    }
    if (command === "export_diagnostic_entries") {
      return [
        recordedEntry,
        {
          level: "error",
          message: "Persisted request https://relay.example.com/path?secret=leaked",
          detail: "opaque_abcdefghijklmnopqrstuvwxyz1234567890",
          createdAt: "2026-07-07T00:00:00.000Z"
        },
        { level: "debug", message: "invalid", createdAt: "2026-07-07T00:00:00.000Z" }
      ];
    }
  });
  recordDiagnosticEvent("warn", "Current process entry");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const bundle = JSON.parse(await buildDiagnosticBundle(new Date("2026-07-08T00:00:00.000Z"))) as {
    entries: Array<{ level: string; message: string; detail?: string }>;
  };

  assert.equal(bundle.entries.length, 2);
  assert.equal(bundle.entries[0].level, "error");
  assert.doesNotMatch(bundle.entries[0].message, /secret=leaked/);
  assert.doesNotMatch(bundle.entries[0].detail ?? "", /opaque_/);
  assert.equal(bundle.entries[1].message, "Current process entry");
});

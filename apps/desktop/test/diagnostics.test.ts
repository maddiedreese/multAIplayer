import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { JSDOM } from "jsdom";
import {
  clearDiagnosticEntries,
  loadDiagnosticEntries,
  recordDiagnosticEvent,
  saveNativeDiagnosticBundle
} from "../src/lib/platform/diagnostics";
import { reportExpectedFailure, reportNonFatal } from "../src/lib/core/nonFatalReporting";

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
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.level, "error");
  const redactedUrl = new URL(entry.detail ?? "");
  assert.equal(redactedUrl.origin, "https://relay.example.com");
  assert.equal(redactedUrl.pathname, "/invites%20[redacted-token]");
  assert.equal(redactedUrl.search, "");
  assert.doesNotMatch(entry.detail ?? "", /token=abc/);
  assert.doesNotMatch(entry.detail ?? "", /gho_/);
});

test("recoverable failures are countable without including rejected input", () => {
  reportNonFatal("discard corrupt security settings");
  const entries = loadDiagnosticEntries();
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.message, "Non-fatal failure: discard corrupt security settings");
  assert.equal(entry.detail, undefined);
});

test("recoverable failures preserve redacted error context", () => {
  reportNonFatal("publish workflow event", new Error("request failed for token_abcdefghijklmnopqrstuvwxyz123456"));

  const [entry] = loadDiagnosticEntries();
  assert.ok(entry);
  assert.equal(entry.message, "Non-fatal failure: publish workflow event");
  assert.match(entry.detail ?? "", /^Error: request failed for /);
  assert.doesNotMatch(entry.detail ?? "", /token_abcdefghijklmnopqrstuvwxyz123456/);
});

test("expected failures stay quiet in the test runtime", () => {
  const originalDebug = console.debug;
  const calls: unknown[][] = [];
  console.debug = (...args: unknown[]) => calls.push(args);
  try {
    reportExpectedFailure("URL validation rejected malformed input");
  } finally {
    console.debug = originalDebug;
  }
  assert.deepEqual(calls, []);
});

test("web-preview diagnostics remain memory-only", () => {
  recordDiagnosticEvent("warn", "Memory only");
  assert.equal(localStorage.length, 0);
  assert.equal(loadDiagnosticEntries().length, 1);
});

test("Tauri diagnostics persist exactly one metadata-only entry", async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
  });

  recordDiagnosticEvent("warn", "Persistence test", { secret: "short-secret", safe: "visible" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.command, "record_diagnostic");
  const entry = (call.payload as Record<string, unknown>).entry as Record<string, unknown>;
  assert.equal(entry.level, "warn");
  assert.equal(entry.message, "Persistence test");
  assert.equal(entry.detail, undefined);
});

test("persisted reports never include room content from error detail", async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
  });

  recordDiagnosticEvent("error", "React render failure", "private room transcript text");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(loadDiagnosticEntries()[0]?.detail ?? "", /private room transcript text/);
  assert.doesNotMatch(JSON.stringify(calls), /private room transcript text/);
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

test("Tauri persistence is serialized and native save waits for pending writes", async () => {
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
    if (command === "save_diagnostic_bundle") return "saved";
  });

  recordDiagnosticEvent("warn", "First write");
  recordDiagnosticEvent("warn", "Second write");
  const bundlePromise = saveNativeDiagnosticBundle();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(commands, ["record_diagnostic"]);
  finishFirstWrite?.();
  await bundlePromise;
  assert.deepEqual(commands, ["record_diagnostic", "record_diagnostic", "save_diagnostic_bundle"]);
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

  const [entry] = loadDiagnosticEntries();
  assert.ok(entry);
  const detail = entry.detail ?? "";
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

test("object diagnostics omit compound sensitive keys while retaining benign near-matches", () => {
  recordDiagnosticEvent("warn", "Compound key safety", {
    apiKey: "api-key-value",
    private_key: "private-key-value",
    "signing key": "signing-key-value",
    sessionToken: "session-token-value",
    "refresh-token": "refresh-token-value",
    roomSecret: "room-secret-value",
    recoveryPassphrase: "recovery-passphrase-value",
    BODY: "body-value",
    plain_text: "plaintext-value",
    keyboard: "retained-keyboard",
    tokenCount: 3,
    secretive: "retained-secretive",
    passphrases: "retained-passphrases",
    bodyLength: 10,
    plaintextFormat: "retained-format"
  });

  const [entry] = loadDiagnosticEntries();
  assert.ok(entry);
  const detail = entry.detail;
  assert.ok(detail);
  const sanitized = JSON.parse(detail) as Record<string, unknown>;
  for (const key of [
    "apiKey",
    "private_key",
    "signing key",
    "sessionToken",
    "refresh-token",
    "roomSecret",
    "recoveryPassphrase",
    "BODY",
    "plain_text"
  ]) {
    assert.equal(sanitized[key], "[omitted]", `${key} should be omitted`);
  }
  assert.deepEqual(
    {
      keyboard: sanitized.keyboard,
      tokenCount: sanitized.tokenCount,
      secretive: sanitized.secretive,
      passphrases: sanitized.passphrases,
      bodyLength: sanitized.bodyLength,
      plaintextFormat: sanitized.plaintextFormat
    },
    {
      keyboard: "retained-keyboard",
      tokenCount: 3,
      secretive: "retained-secretive",
      passphrases: "retained-passphrases",
      bodyLength: 10,
      plaintextFormat: "retained-format"
    }
  );
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

  const [entry] = loadDiagnosticEntries();
  assert.ok(entry);
  const detail = entry.detail ?? "";
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
  const [entry] = loadDiagnosticEntries();
  assert.ok(entry);
  assert.equal(entry.detail, "Error: safe failure");
});

test("diagnostic memory ring retains only the newest 80 entries", () => {
  for (let index = 0; index < 85; index += 1) recordDiagnosticEvent("warn", `Event ${index}`);
  const entries = loadDiagnosticEntries();
  assert.equal(entries.length, 80);
  assert.equal(entries.at(0)?.message, "Event 5");
  assert.equal(entries.at(79)?.message, "Event 84");
});

test("native bundle save sends bounded context but never reads persisted entries into JavaScript", async () => {
  localStorage.setItem(
    "multaiplayer:app-config",
    JSON.stringify({
      relayHttpUrl: "https://relay.example.com/api?secret=leaked",
      relayWsUrl: "wss://relay.example.com/rooms?secret=leaked"
    })
  );
  const calls: Array<{ command: string; payload: unknown }> = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
    if (command === "save_diagnostic_bundle") return "saved";
  });
  recordDiagnosticEvent("warn", "Current process entry");
  assert.equal(await saveNativeDiagnosticBundle(), "saved");

  assert.deepEqual(
    calls.map(({ command }) => command),
    ["record_diagnostic", "save_diagnostic_bundle"]
  );
  assert.equal(
    calls.some(({ command }) => command === "export_diagnostic_entries"),
    false
  );
  const context = (calls[1]?.payload as Record<string, unknown>).context as Record<string, unknown>;
  assert.equal(context.relayHttpOrigin, "https://relay.example.com");
  assert.equal(context.relayWsOrigin, "wss://relay.example.com");
  assert.equal("entries" in context, false);
  assert.doesNotMatch(JSON.stringify(context), /secret=leaked|Current process entry/);
});

test("native bundle save reduces rejected or malformed outcomes to a stable failure", async () => {
  mockIPC((command) => {
    if (command === "save_diagnostic_bundle") return "unexpected";
  });
  assert.equal(await saveNativeDiagnosticBundle(), "failed");

  mockIPC((command) => {
    if (command === "save_diagnostic_bundle") return Promise.reject(new Error("sensitive failure"));
  });
  assert.equal(await saveNativeDiagnosticBundle(), "failed");
});

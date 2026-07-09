import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
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

test("diagnostics remain memory-only", () => {
  recordDiagnosticEvent("warn", "Memory only");
  assert.equal(localStorage.length, 0);
  assert.equal(loadDiagnosticEntries().length, 1);
});

test("buildDiagnosticBundle includes app metadata and relay origins only", () => {
  localStorage.setItem("multaiplayer:app-config", JSON.stringify({
    relayHttpUrl: "https://relay.example.com/api?secret=1",
    relayWsUrl: "wss://relay.example.com/rooms?secret=1"
  }));
  recordDiagnosticEvent("warn", "Something happened");
  const bundle = buildDiagnosticBundle(new Date("2026-07-08T00:00:00.000Z"));
  assert.match(bundle, /"version": "0\.1\.0-alpha\.0"/);
  assert.match(bundle, /"httpOrigin": "https:\/\/relay\.example\.com"/);
  assert.match(bundle, /"wsOrigin": "wss:\/\/relay\.example\.com"/);
  assert.doesNotMatch(bundle, /secret=1/);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { reportExpectedFailure, reportNonFatal } from "../src/lib/core/nonFatalReporting";

const originalNodeEnv = process.env.NODE_ENV;
const originalDebug = console.debug;
const originalWarn = console.warn;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  console.debug = originalDebug;
  console.warn = originalWarn;
});

test("the test runtime suppresses only classified recoverable diagnostics", () => {
  process.env.NODE_ENV = "test";
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  console.debug = (...args: unknown[]) => debugCalls.push(args);
  console.warn = (...args: unknown[]) => warnCalls.push(args);

  reportExpectedFailure("known fallback");
  reportNonFatal("known recoverable failure", new Error("not emitted by the fallback reporter"));

  assert.deepEqual(debugCalls, []);
  assert.deepEqual(warnCalls, []);
});

test("non-test runtimes retain classified diagnostic breadcrumbs", () => {
  process.env.NODE_ENV = "production";
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  console.debug = (...args: unknown[]) => debugCalls.push(args);
  console.warn = (...args: unknown[]) => warnCalls.push(args);

  reportExpectedFailure("known fallback");
  reportNonFatal("known recoverable failure");

  assert.deepEqual(debugCalls, [["[expected failure] known fallback"]]);
  assert.deepEqual(warnCalls, [["Non-fatal failure: known recoverable failure"]]);
});

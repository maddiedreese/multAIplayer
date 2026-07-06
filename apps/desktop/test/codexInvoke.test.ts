import assert from "node:assert/strict";
import test from "node:test";
import { extractCodexBrowserOpenUrl, messageInvokesCodex, normalizeBrowserCommandUrl } from "../src/lib/codexInvoke";

test("messageInvokesCodex accepts explicit Codex mentions case-insensitively", () => {
  assert.equal(messageInvokesCodex("@Codex please review this diff"), true);
  assert.equal(messageInvokesCodex("could @codex run tests?"), true);
  assert.equal(messageInvokesCodex("ship it, @CODEX."), true);
  assert.equal(messageInvokesCodex("codex, open localhost"), true);
});

test("messageInvokesCodex rejects ordinary words and longer handles", () => {
  assert.equal(messageInvokesCodex("codex should not run yet"), false);
  assert.equal(messageInvokesCodex("@codexish should not run"), false);
  assert.equal(messageInvokesCodex("maddie@example.com @code"), false);
});

test("extractCodexBrowserOpenUrl reads Codex-addressed browser commands", () => {
  assert.equal(extractCodexBrowserOpenUrl("codex, open localhost"), "http://localhost/");
  assert.equal(extractCodexBrowserOpenUrl("@Codex open github.com/maddiedreese/multAIplayer"), "http://github.com/maddiedreese/multAIplayer");
  assert.equal(extractCodexBrowserOpenUrl("please open localhost"), null);
});

test("normalizeBrowserCommandUrl supports http and https locations", () => {
  assert.equal(normalizeBrowserCommandUrl("127.0.0.1:1420"), "http://127.0.0.1:1420/");
  assert.equal(normalizeBrowserCommandUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeBrowserCommandUrl("file:///tmp/secret"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { openTrustedAuthenticationUrl, trustedAuthenticationUrl } from "../src/lib/authExternalUrl";

test("authentication navigation accepts only the expected HTTPS provider origins", () => {
  assert.equal(
    trustedAuthenticationUrl("github", "https://github.com/login/device"),
    "https://github.com/login/device"
  );
  assert.equal(
    trustedAuthenticationUrl("openai", "https://auth.openai.com/oauth/authorize?client_id=codex"),
    "https://auth.openai.com/oauth/authorize?client_id=codex"
  );
  assert.equal(
    trustedAuthenticationUrl("openai", "https://chatgpt.com/auth/device"),
    "https://chatgpt.com/auth/device"
  );
});

test("authentication navigation rejects lookalikes, credentials, insecure URLs, and unrelated paths", () => {
  for (const value of [
    "http://github.com/login/device",
    "https://github.com.evil.test/login/device",
    "https://user:secret@github.com/login/device",
    "https://github.com/login/device?continue=elsewhere",
    "https://github.com/login/device#fragment",
    "https://github.com/settings/tokens",
    "javascript:alert(1)",
    "not a URL"
  ]) {
    assert.equal(trustedAuthenticationUrl("github", value), null);
  }
  assert.equal(trustedAuthenticationUrl("openai", "https://auth.openai.com.evil.test/oauth"), null);
});

test("browser runtime opens only a validated authentication URL in an external browsing context", async () => {
  const originalWindow = globalThis.window;
  const opened: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open: (url: string) => {
        opened.push(url);
        return {};
      }
    }
  });
  try {
    assert.equal(await openTrustedAuthenticationUrl("github", "https://github.com/login/device"), true);
    assert.equal(await openTrustedAuthenticationUrl("github", "https://evil.test/login/device"), false);
    assert.deepEqual(opened, ["https://github.com/login/device"]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

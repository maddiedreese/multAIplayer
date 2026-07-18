import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRelaySession,
  installRelaySession,
  relayFetch,
  relayWebSocketProtocols
} from "../src/lib/relay/relaySession";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      key === "multaiplayer:app-config"
        ? JSON.stringify({ relayHttpUrl: "https://relay.test", relayWsUrl: "wss://relay.test/rooms" })
        : null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 1
  }
});

test("opaque relay sessions stay in memory and attach only to the exact relay origin", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });
      return new Response("{}", { status: 200 });
    }
  });
  try {
    installRelaySession("native_session-123", "https://relay.test");
    await relayFetch("https://relay.test/teams", { method: "GET" });
    const request = requests[0]!;
    assert.equal(request.url, "https://relay.test/teams");
    assert.equal(new Headers(request.init?.headers).get("x-multaiplayer-session"), "native_session-123");
    assert.equal(request.init?.credentials, "include");
    assert.deepEqual(relayWebSocketProtocols("wss://relay.test/rooms"), [
      "multaiplayer-v1",
      "multaiplayer-session.native_session-123"
    ]);
    await assert.rejects(() => relayFetch("https://attacker.example/collect"), /authenticated relay origin/);
  } finally {
    clearRelaySession();
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  }
  assert.equal(relayWebSocketProtocols("wss://relay.test/rooms"), undefined);
});

test("relay session installation rejects malformed native values without retaining them", () => {
  clearRelaySession();
  assert.throws(() => installRelaySession("bad session", "https://relay.test"), /invalid relay session/);
  assert.throws(() => installRelaySession("x".repeat(257), "https://relay.test"), /invalid relay session/);
  assert.throws(() => installRelaySession("valid", "https://attacker.example"), /unexpected origin/);
  assert.equal(relayWebSocketProtocols("wss://relay.test/rooms"), undefined);
});

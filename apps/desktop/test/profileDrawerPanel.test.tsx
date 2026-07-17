import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

const React = (await import("react")).default;
Object.defineProperty(globalThis, "React", { configurable: true, value: React });
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { ProfileDrawerPanel } = await import("../src/components/ProfileDrawerPanel");

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => JSON.stringify({ relayHttpUrl: "https://relay.example", relayWsUrl: "wss://relay.example" }),
    removeItem: () => undefined
  }
});

afterEach(() => cleanup());

test("accepted hosted-account deletion is reported as protected and pending cleanup", async () => {
  const originalFetch = globalThis.fetch;
  let deleted = 0;
  const deletionRequests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    deletionRequests.push({ input: String(input), ...(init === undefined ? {} : { init }) });
    return new Response(
      JSON.stringify({
        ok: true,
        status: "pending",
        deleted: null,
        retainedSharedData: ["team_and_room_records"]
      }),
      { status: 202, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const view = render(
      <ProfileDrawerPanel
        currentUser={{ id: "github:123", login: "octocat", name: "Octo Cat" }}
        authConfig={{
          provider: "github",
          configured: true,
          scopes: ["repo", "read:user"],
          mutationsRequireAuth: true,
          allowedOrigins: ["tauri://localhost"],
          sessionPersistence: "identity_only"
        }}
        authBusy={false}
        authError={null}
        deviceFlow={null}
        deviceId="device-test"
        deviceIdentity={null}
        deviceIdentityMessage={null}
        relaySessionPersistence="Encrypted"
        codexAccountPanel={null}
        onHostedAccountDeleted={() => {
          deleted += 1;
        }}
        onSignIn={() => undefined}
        onSignOut={() => undefined}
      />
    );
    assert.equal(view.queryByRole("button", { name: "Reset device identity" }), null);
    assert.match(view.getByText("GitHub identity scope").parentElement?.textContent ?? "", /workspace identity/i);
    assert.match(
      view.getByText("Repository workflow scope").parentElement?.textContent ?? "",
      /public and private repository workflows/i
    );

    fireEvent.click(view.getByRole("button", { name: "Delete hosted account data" }));
    const confirmation = view.getByLabelText(/Type delete my account to confirm/) as HTMLInputElement;
    fireEvent.change(confirmation, {
      target: { value: "delete my account" }
    });
    const submit = view.getByRole("button", { name: "Permanently delete hosted account data" }) as HTMLButtonElement;
    await waitFor(() => assert.equal(submit.disabled, false));
    fireEvent.click(submit);

    await waitFor(() => {
      assert.ok(view.getByText(/Deletion request protected and pending primary cleanup/i));
    });
    assert.equal(deleted, 1);
    const deletionRequest = deletionRequests.at(-1);
    assert.equal(deletionRequest?.input, "https://relay.example/auth/account");
    assert.equal(deletionRequest?.init?.method, "DELETE");
    assert.equal(deletionRequest?.init?.body, JSON.stringify({ confirmation: "delete my account" }));
    assert.match(view.getByText("Account deletion status").parentElement?.textContent ?? "", /durably accepted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

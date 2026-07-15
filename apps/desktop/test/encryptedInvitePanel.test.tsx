import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { EncryptedInvitePanel } from "../src/components/EncryptedInvitePanel";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  React
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

test("invite flow prominently identifies the unaudited cryptographic boundary", () => {
  const view = render(
    <EncryptedInvitePanel
      copyDisabled={false}
      inviteSecretInput=""
      inviteRequests={[]}
      localDeviceId="device-a"
      importDisabled={false}
      approvalDisabled={false}
      inviteLink={null}
      inviteMessage={null}
      onCopyInvite={() => undefined}
      onInviteSecretInputChange={() => undefined}
      onImportInvite={() => undefined}
      onDecideInviteRequest={() => undefined}
    />
  );

  const warning = view.getByRole("note", { name: "Unaudited cryptography warning" });
  assert.match(warning.textContent ?? "", /cryptographic integration is unaudited/i);
  assert.match(warning.textContent ?? "", /verify the person and device/i);
});

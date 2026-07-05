import assert from "node:assert/strict";
import test from "node:test";
import type { RequestStatusPlaintextPayload } from "@multaiplayer/protocol";
import { browserDecisionMessageId, buildBrowserDecisionMessage } from "../src/lib/browserActivity";

const decision: RequestStatusPlaintextPayload = {
  requestId: "browser-request-1",
  status: "approved",
  decidedBy: "Maddie",
  decidedByUserId: "github:maddie",
  decidedAt: "2026-07-04T12:00:00.000Z"
};

test("browser decision messages include URL, requester, and decider", () => {
  assert.equal(
    buildBrowserDecisionMessage(
      decision,
      { url: "https://docs.example.com/guide", requester: "Alex" },
      (url) => new URL(url).origin
    ),
    "Maddie approved https://docs.example.com for Alex."
  );
});

test("browser decision messages fall back when the original request is unavailable", () => {
  assert.equal(
    buildBrowserDecisionMessage({ ...decision, status: "denied" }, undefined, (url) => url),
    "Maddie denied a browser access request."
  );
});

test("browser decision message ids are stable per decision", () => {
  assert.equal(
    browserDecisionMessageId(decision),
    "browser:browser-request-1:approved:2026-07-04T12:00:00.000Z"
  );
});

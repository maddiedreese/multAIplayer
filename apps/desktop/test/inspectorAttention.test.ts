import assert from "node:assert/strict";
import test from "node:test";
import { countPendingRequests, inspectorAttentionCounts } from "../src/lib/inspectorAttention";

test("countPendingRequests only counts pending room requests", () => {
  assert.equal(countPendingRequests([
    { status: "pending" },
    { status: "approved" },
    { status: "denied" },
    { status: "pending" }
  ]), 2);
});

test("inspectorAttentionCounts separates work and browser attention", () => {
  assert.deepEqual(
    inspectorAttentionCounts({
      approvalVisible: true,
      terminalRequests: [
        { status: "pending" },
        { status: "approved" }
      ],
      browserRequests: [
        { status: "pending" },
        { status: "denied" },
        { status: "pending" }
      ]
    }),
    { work: 2, browser: 2 }
  );
});

test("inspectorAttentionCounts is quiet when nothing needs host attention", () => {
  assert.deepEqual(
    inspectorAttentionCounts({
      approvalVisible: false,
      terminalRequests: [{ status: "approved" }],
      browserRequests: [{ status: "denied" }]
    }),
    { work: 0, browser: 0 }
  );
});

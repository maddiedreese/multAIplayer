import assert from "node:assert/strict";
import test from "node:test";
import { formatActiveRoomModes, roomPostureSummary } from "../src/lib/roomPosture";

test("formatActiveRoomModes lists active modes in product order", () => {
  assert.equal(
    formatActiveRoomModes({ chat: true, code: false, workspace: true, browser: true }),
    "Chat, Workspace, Browser"
  );
  assert.equal(
    formatActiveRoomModes({ chat: false, code: false, workspace: false, browser: false }),
    "No modes enabled"
  );
});

test("roomPostureSummary explains host, workspace, history, and browser posture", () => {
  assert.deepEqual(
    roomPostureSummary({
      locked: false,
      isActiveHost: true,
      canReadLocalWorkspace: true,
      historySettings: { enabled: true, retentionDays: 30 },
      browserProfilePersistent: false,
      mode: { chat: true, code: true, workspace: true, browser: false }
    }),
    {
      hostAccess: "This device is host",
      workspaceAccess: "Local project readable",
      history: "Encrypted, 30 days",
      browserProfile: "Refreshes before opens",
      modes: "Chat, Code, Workspace"
    }
  );
});

test("roomPostureSummary makes locked and disabled states visible", () => {
  assert.deepEqual(
    roomPostureSummary({
      locked: true,
      isActiveHost: false,
      canReadLocalWorkspace: false,
      historySettings: { enabled: false, retentionDays: 30 },
      browserProfilePersistent: true,
      mode: { chat: false, code: false, workspace: false, browser: false }
    }),
    {
      hostAccess: "Locked on this device",
      workspaceAccess: "No local workspace access",
      history: "Disabled",
      browserProfile: "Persists per room",
      modes: "No modes enabled"
    }
  );
});

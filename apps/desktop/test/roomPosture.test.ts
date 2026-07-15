import assert from "node:assert/strict";
import test from "node:test";
import { roomPostureSummary } from "../src/lib/room/roomPosture";

test("roomPostureSummary explains host, workspace, history, and browser posture", () => {
  assert.deepEqual(
    roomPostureSummary({
      locked: false,
      isActiveHost: true,
      canReadLocalWorkspace: true,
      historySettings: { enabled: true, retentionDays: 30 },
      browserProfilePersistent: false
    }),
    {
      hostAccess: "This device is host",
      workspaceAccess: "Shared with room",
      history: "Encrypted, 30 days",
      browserProfile: "Refreshes before opens"
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
      browserProfilePersistent: true
    }),
    {
      hostAccess: "Locked on this device",
      workspaceAccess: "Locked on this device",
      history: "Disabled",
      browserProfile: "Persists per room"
    }
  );
});

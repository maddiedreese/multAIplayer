import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceKeyAgreementIdentity, createRoomSecret } from "@multaiplayer/crypto";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createRoomKeyRotationActions } from "../src/lib/invite/roomKeyRotationActions";
import { pinInviteDeviceKey } from "../src/lib/inviteCapabilityStore";
import { importRoomSecret } from "../src/lib/localHistory";
import { useAppStore } from "../src/store/appStore";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });

const room: RoomRecord = {
  id: "room-rotation-security",
  teamId: "team-rotation-security",
  name: "Secure rotation",
  projectPath: "/tmp",
  host: "Host",
  hostUserId: "github:host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: false,
  unread: 0
};

test("rotation rejects relay-substituted and injected unpinned recipient keys before wrapping", async () => {
  localStorage.clear();
  useAppStore.getState().resetAppStore();
  const host = await createDeviceKeyAgreementIdentity();
  const legitimate = await createDeviceKeyAgreementIdentity();
  const attacker = await createDeviceKeyAgreementIdentity();
  useAppStore.setState({ deviceIdentity: host, relayStatus: "open", trustedDeviceKeys: [] });
  await importRoomSecret(room.id, await createRoomSecret());
  assert.equal(
    pinInviteDeviceKey(room.id, "github:peer", "device-peer", legitimate.publicKeyFingerprint, legitimate.publicKeyJwk),
    true
  );

  const originalFetch = globalThis.fetch;
  const attempts = [
    { userId: "github:peer", deviceId: "device-peer" },
    { userId: "github:injected", deviceId: "device-injected" }
  ];
  try {
    for (const identity of attempts) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            devices: [
              {
                ...identity,
                displayName: "Attacker",
                publicKeyJwk: attacker.publicKeyJwk,
                publicKeyFingerprint: attacker.publicKeyFingerprint,
                registeredAt: "2026-07-10T12:00:00.000Z",
                lastSeenAt: "2026-07-10T12:00:00.000Z"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      const relay = {
        publish: () => assert.fail("unverified key was published"),
        publishAndWaitForAck: async () => assert.fail("unverified key was published"),
        close: () => undefined
      };
      const actions = createRoomKeyRotationActions({
        historyLoadedRoomIds: { current: new Set<string>() },
        relayRef: { current: relay },
        seenEnvelopeIds: { current: new Set<string>() },
        selectedRoomIdRef: { current: room.id },
        reportRoomKeyRotationInFlight: () => false
      });
      await assert.rejects(
        actions.rotateRoomKeyForDevices(room, { id: "github:host", name: "Host" }, "device-host"),
        /unverified device keys/
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

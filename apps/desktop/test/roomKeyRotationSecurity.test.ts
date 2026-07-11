import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  decryptJson,
  encryptJson,
  unwrapRoomSecretAuthenticatedFromDevice
} from "@multaiplayer/crypto";
import { RoomKeyRotationPlaintextPayload, type RelayEnvelope, type RoomRecord } from "@multaiplayer/protocol";
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

test("failed rotation retry after removal rebuilds without wrapping to the removed device", async () => {
  localStorage.clear();
  useAppStore.getState().resetAppStore();
  const host = await createDeviceKeyAgreementIdentity();
  const removed = await createDeviceKeyAgreementIdentity();
  useAppStore.setState({ deviceIdentity: host, relayStatus: "open", trustedDeviceKeys: [] });
  const oldSecret = await createRoomSecret();
  await importRoomSecret(room.id, oldSecret);
  assert.equal(
    pinInviteDeviceKey(room.id, "github:removed", "device-removed", removed.publicKeyFingerprint, removed.publicKeyJwk),
    true
  );
  const devices = [
    {
      userId: "github:host",
      deviceId: "device-host",
      displayName: "Host",
      publicKeyJwk: host.publicKeyJwk,
      publicKeyFingerprint: host.publicKeyFingerprint,
      registeredAt: "2026-07-10T12:00:00.000Z",
      lastSeenAt: "2026-07-10T12:00:00.000Z"
    },
    {
      userId: "github:removed",
      deviceId: "device-removed",
      displayName: "Removed",
      publicKeyJwk: removed.publicKeyJwk,
      publicKeyFingerprint: removed.publicKeyFingerprint,
      registeredAt: "2026-07-10T12:00:00.000Z",
      lastSeenAt: "2026-07-10T12:00:00.000Z"
    }
  ];
  const originalFetch = globalThis.fetch;
  const published: RelayEnvelope[] = [];
  let attempt = 0;
  try {
    globalThis.fetch = async (input) =>
      String(input).includes("/devices")
        ? new Response(JSON.stringify({ devices }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    const relay = {
      publish: () => undefined,
      publishAndWaitForAck: async ({ envelope }: { envelope: RelayEnvelope }) => {
        published.push(envelope);
        if (attempt++ === 0) throw new Error("simulated publish failure");
      },
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
      /simulated publish failure/
    );
    await actions.rotateRoomKeyForDevices(
      room,
      { id: "github:host", name: "Host" },
      "device-host",
      new Set(["github:removed"])
    );

    const payload = RoomKeyRotationPlaintextPayload.parse(
      await decryptJson(published[1]!.payload, oldSecret, published[1]!)
    );
    assert.deepEqual(
      payload.recipients.map(({ userId }) => userId),
      ["github:host"]
    );
    assert.notEqual(published[0]!.payload.ciphertext, published[1]!.payload.ciphertext);
    const hostWrap = payload.recipients[0]!.wrappedRoomSecret;
    const newSecret = await unwrapRoomSecretAuthenticatedFromDevice(hostWrap, host.privateKeyJwk, host.publicKeyJwk, {
      purpose: "room-key-rotation",
      teamId: room.teamId,
      roomId: room.id,
      senderUserId: "github:host",
      senderDeviceId: "device-host",
      recipientDeviceId: "device-host",
      operationId: payload.id,
      keyEpoch: payload.previousEpoch,
      previousEpoch: payload.previousEpoch,
      newEpoch: payload.newEpoch
    });
    const metadata = { ...published[1]!, id: "future", kind: "chat.message" as const, keyEpoch: payload.newEpoch };
    const future = await encryptJson({ marker: "future-secret" }, newSecret, metadata);
    await assert.rejects(() => decryptJson(future, oldSecret, metadata));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

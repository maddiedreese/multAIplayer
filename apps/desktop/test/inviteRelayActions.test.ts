import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createInviteRelayActions } from "../src/lib/invite/inviteRelayActions";
import type { InviteJoinRequest } from "../src/types";
import {
  computeInviteCapabilityMac,
  createDeviceKeyAgreementIdentity,
  createInviteCapability,
  createRoomSecret
} from "@multaiplayer/crypto";
import { rememberIssuedInviteCapability } from "../src/lib/inviteCapabilityStore";
import { useAppStore } from "../src/store/appStore";
import { currentLocalIdentity } from "../src/lib/selectedWorkspace";
import { importRoomSecret, installRoomSecretEpoch } from "../src/lib/localHistory";

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
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const room: RoomRecord = {
  id: "room-invite",
  teamId: "team-alpha",
  name: "Invite",
  projectPath: "/tmp/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

function setup(overrides: Record<string, unknown> = {}) {
  const appended: InviteJoinRequest[] = [];
  const statusUpdates: Array<{ requestId: string; status: InviteJoinRequest["status"] }> = [];
  const roomMessages: Array<string | null> = [];
  const selectedMessages: Array<string | null> = [];
  const options = {
    deviceId: "device-local",
    deviceIdentity: null,
    hasSelectedRoom: true,
    hostGateMessage: "Only the host can decide.",
    inviteRequests: [],
    isActiveHost: true,
    isSelectedRoomLocked: false,
    isSelectedRoomRevoked: false,
    localUser: { id: "github:maddie", name: "Maddie" },
    relayRef: { current: null },
    relayStatus: "closed",
    seenEnvelopeIds: { current: new Set<string>() },
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    ...overrides
  };
  const actions = createInviteRelayActions(options, {
    appendInviteRequest: (_roomId, request) => appended.push(request),
    rememberForgottenRoom: () => undefined,
    restoreForgottenRoom: () => undefined,
    setInviteMessageForRoom: (roomId, message) => {
      roomMessages.push(message);
      if (roomId === options.selectedRoomIdRef.current) selectedMessages.push(message);
    },
    updateInviteRequestStatus: (_roomId, requestId, status) => statusUpdates.push({ requestId, status })
  });
  return { actions, appended, roomMessages, selectedMessages, statusUpdates };
}

async function validRequest() {
  const requester = await createDeviceKeyAgreementIdentity();
  const host = await createDeviceKeyAgreementIdentity();
  useAppStore.getState().replaceDeviceIdentity(host);
  const local = currentLocalIdentity();
  const capability = createInviteCapability();
  const invite = {
    version: 2 as const,
    teamId: room.teamId,
    roomId: room.id,
    roomName: room.name,
    inviteCapability: capability,
    keyEpoch: 1,
    hostUserId: local.localUser.id,
    hostDeviceId: local.deviceId,
    hostPublicKeyJwk: host.publicKeyJwk,
    hostPublicKeyFingerprint: host.publicKeyFingerprint
  };
  await rememberIssuedInviteCapability("invite-1", invite);
  const request = {
    eventType: "invite.request" as const,
    id: "device-peer:request-1",
    inviteId: "invite-1",
    requester: "Peer",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requesterPublicKeyJwk: requester.publicKeyJwk,
    requesterPublicKeyFingerprint: requester.publicKeyFingerprint,
    hostUserId: invite.hostUserId,
    hostDeviceId: invite.hostDeviceId,
    hostPublicKeyFingerprint: invite.hostPublicKeyFingerprint,
    keyEpoch: 1,
    requestNonce: "abcdefghijklmnopqrstuv",
    capability,
    requestedAt: "2026-07-09T12:00:00.000Z"
  };
  const capabilityMac = await computeInviteCapabilityMac(capability, {
    phase: "request",
    inviteId: "invite-1",
    teamId: room.teamId,
    roomId: room.id,
    keyEpoch: 1,
    requestId: request.id,
    requestNonce: request.requestNonce,
    requesterUserId: request.requesterUserId,
    requesterDeviceId: request.requesterDeviceId,
    requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
    hostUserId: request.hostUserId,
    hostDeviceId: request.hostDeviceId,
    hostPublicKeyFingerprint: request.hostPublicKeyFingerprint
  });
  const envelope = {
    id: "envelope-1",
    teamId: room.teamId,
    roomId: room.id,
    senderUserId: "github:peer",
    senderDeviceId: "device-peer",
    createdAt: request.requestedAt,
    kind: "room.invite" as const,
    keyEpoch: 1,
    payload: {
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
      ephemeralPublicKeyJwk: host.publicKeyJwk,
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  };
  return { request: { ...request, capabilityMac }, envelope };
}

test("relay invite actions display only capability-authenticated requests", async () => {
  const { actions, appended } = setup();
  const { request, envelope } = await validRequest();
  await actions.handleInviteEnvelopePlaintext(room.id, request, envelope);

  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.status, "pending");
});

test("relay invite actions reject outer-sender and public-key substitution", async () => {
  const { actions, appended } = setup();
  const { request, envelope } = await validRequest();
  await actions.handleInviteEnvelopePlaintext(room.id, request, { ...envelope, senderDeviceId: "attacker-device" });
  const attacker = await createDeviceKeyAgreementIdentity();
  await actions.handleInviteEnvelopePlaintext(
    room.id,
    { ...request, requesterPublicKeyJwk: attacker.publicKeyJwk },
    envelope
  );
  assert.deepEqual(appended, []);
});

test("relay invite actions reject schema-invalid decrypted payloads", async () => {
  const { actions, appended, statusUpdates } = setup();

  await actions.handleInviteEnvelopePlaintext(room.id, {
    eventType: "invite.request",
    id: "request-invalid",
    requester: "Peer",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requestedAt: "not-a-datetime"
  });
  await actions.handleInviteEnvelopePlaintext(room.id, {
    eventType: "invite.status",
    requestId: "device-peer:request-invalid",
    status: "denied",
    decidedBy: "Maddie",
    decidedByUserId: "github:maddie",
    decidedAt: "not-a-datetime"
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(statusUpdates, []);
});

test("unauthenticated status events never update state", async () => {
  const { actions, roomMessages, statusUpdates } = setup();
  const status = {
    eventType: "invite.status",
    requestId: "device-peer:request-1",
    status: "denied",
    decidedBy: "Maddie",
    decidedByUserId: "github:maddie",
    decidedAt: "2026-07-09T12:01:00.000Z"
  } as const;

  await actions.handleInviteEnvelopePlaintext(room.id, status);

  assert.deepEqual(statusUpdates, []);
  assert.deepEqual(roomMessages, []);
});

test("decision guards preserve the selected-room user message", async () => {
  const { actions, selectedMessages } = setup({ hasSelectedRoom: false });
  const request: InviteJoinRequest = {
    eventType: "invite.request",
    id: "request-1",
    requester: "Peer",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requestedAt: "2026-07-09T12:00:00.000Z",
    status: "pending"
  };

  await actions.decideInviteJoinRequest(request, "approved");

  assert.deepEqual(selectedMessages, ["Create or join a room before deciding invite requests."]);
});

test("approval remains pending after publish failure, succeeds on retry, and consumes capability", async () => {
  localStorage.clear();
  const { request, envelope } = await validRequest();
  const roomRequest = { ...request, status: "pending" as const };
  const local = currentLocalIdentity();
  const activeRoom = { ...room, host: local.localUser.name, hostUserId: local.localUser.id };
  await importRoomSecret(room.id, await createRoomSecret(), 1);
  useAppStore.setState({
    rooms: [activeRoom],
    selectedRoomId: room.id,
    relayStatus: "open",
    inviteByRoom: { [room.id]: { requests: [roomRequest] } }
  });
  let attempts = 0;
  const relay = {
    publish: () => undefined,
    publishAndWaitForAck: async () => {
      if (attempts++ === 0) throw new Error("ack failed");
    }
  };
  const { actions, statusUpdates, appended } = setup({ relayRef: { current: relay } });
  await actions.decideInviteJoinRequest(roomRequest, "approved");
  assert.deepEqual(statusUpdates, []);
  await actions.decideInviteJoinRequest(roomRequest, "approved");
  assert.deepEqual(statusUpdates, [{ requestId: roomRequest.id, status: "approved" }]);
  const replay = {
    ...request,
    id: "device-peer:request-2",
    requestNonce: "zyxwvutsrqponmlkjihgfe",
    capabilityMac: await computeInviteCapabilityMac(request.capability, {
      phase: "request",
      inviteId: request.inviteId!,
      teamId: envelope.teamId,
      roomId: envelope.roomId,
      keyEpoch: request.keyEpoch,
      requestId: "device-peer:request-2",
      requestNonce: "zyxwvutsrqponmlkjihgfe",
      requesterUserId: request.requesterUserId,
      requesterDeviceId: request.requesterDeviceId,
      requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
      hostUserId: request.hostUserId,
      hostDeviceId: request.hostDeviceId,
      hostPublicKeyFingerprint: request.hostPublicKeyFingerprint
    })
  };
  await actions.handleInviteEnvelopePlaintext(room.id, replay, envelope);
  assert.deepEqual(appended, []);
});

test("room-key rotation invalidates an outstanding invite capability", async () => {
  localStorage.clear();
  const { request } = await validRequest();
  const roomRequest = { ...request, status: "pending" as const };
  const local = currentLocalIdentity();
  const activeRoom = { ...room, host: local.localUser.name, hostUserId: local.localUser.id };
  await importRoomSecret(room.id, await createRoomSecret(), 1);
  await installRoomSecretEpoch(room.id, 2, await createRoomSecret());
  useAppStore.setState({
    rooms: [activeRoom],
    selectedRoomId: room.id,
    relayStatus: "open",
    inviteByRoom: { [room.id]: { requests: [roomRequest] } }
  });
  let published = false;
  const relay = {
    publish: () => undefined,
    publishAndWaitForAck: async () => {
      published = true;
    }
  };
  const { actions, statusUpdates, roomMessages } = setup({ relayRef: { current: relay } });
  await actions.decideInviteJoinRequest(roomRequest, "approved");
  assert.equal(published, false);
  assert.deepEqual(statusUpdates, []);
  assert.match(roomMessages.at(-1) ?? "", /expired after room access changed/);
});

test("concurrent decisions sharing one capability publish only one delivery", async () => {
  localStorage.clear();
  const { request } = await validRequest();
  const roomRequest = { ...request, status: "pending" as const };
  const local = currentLocalIdentity();
  const activeRoom = { ...room, host: local.localUser.name, hostUserId: local.localUser.id };
  await importRoomSecret(room.id, await createRoomSecret(), 1);
  useAppStore.setState({
    rooms: [activeRoom],
    selectedRoomId: room.id,
    relayStatus: "open",
    inviteByRoom: { [room.id]: { requests: [roomRequest] } }
  });
  let releaseAck!: () => void;
  const ack = new Promise<void>((resolve) => {
    releaseAck = resolve;
  });
  let deliveries = 0;
  const relay = {
    publish: () => undefined,
    publishAndWaitForAck: async () => {
      deliveries += 1;
      await ack;
    }
  };
  const { actions, statusUpdates } = setup({ relayRef: { current: relay } });
  const first = actions.decideInviteJoinRequest(roomRequest, "approved");
  await Promise.resolve();
  const second = actions.decideInviteJoinRequest(roomRequest, "denied");
  await Promise.resolve();
  releaseAck();
  await Promise.all([first, second]);
  assert.equal(deliveries, 1);
  assert.equal(statusUpdates.length, 1);
});

test("invite decision lock survives action factory recreation", async () => {
  localStorage.clear();
  const { request } = await validRequest();
  const roomRequest = { ...request, status: "pending" as const };
  const local = currentLocalIdentity();
  const activeRoom = { ...room, host: local.localUser.name, hostUserId: local.localUser.id };
  await importRoomSecret(room.id, await createRoomSecret(), 1);
  useAppStore.setState({
    rooms: [activeRoom],
    selectedRoomId: room.id,
    relayStatus: "open",
    inviteByRoom: { [room.id]: { requests: [roomRequest] } }
  });
  let releaseAck!: () => void;
  const ack = new Promise<void>((resolve) => {
    releaseAck = resolve;
  });
  let deliveries = 0;
  const relay = {
    publish: () => undefined,
    publishAndWaitForAck: async () => {
      deliveries += 1;
      await ack;
    }
  };
  const firstFactory = setup({ relayRef: { current: relay } });
  const rerenderedFactory = setup({ relayRef: { current: relay } });
  const first = firstFactory.actions.decideInviteJoinRequest(roomRequest, "approved");
  await Promise.resolve();
  const second = rerenderedFactory.actions.decideInviteJoinRequest(roomRequest, "denied");
  await Promise.resolve();
  releaseAck();
  await Promise.all([first, second]);
  assert.equal(deliveries, 1);
  assert.equal(firstFactory.statusUpdates.length + rerenderedFactory.statusUpdates.length, 1);
});

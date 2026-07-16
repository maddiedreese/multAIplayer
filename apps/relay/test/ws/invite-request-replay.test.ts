import test from "node:test";
import { WebSocket, assert, delay, onceOpen, startRelay, waitForJoined } from "../support/relay.js";

const createdAt = "2026-07-13T12:00:00.000Z";
const expiresAt = "2099-07-13T12:00:00.000Z";
const keyPackageHash = `sha256:${"a".repeat(64)}`;

test("joining replays pending invite requests only to the exact active host device", async () => {
  const relay = await startRelay({}, inviteReplayFixture());
  const sockets: WebSocket[] = [];
  try {
    const otherDevice = await joinAndCollect("github:host", "host-device-2");
    const otherUser = await joinAndCollect("github:member", "member-device-1");
    assert.deepEqual(inviteNotifications(otherDevice.messages), []);
    assert.deepEqual(inviteNotifications(otherUser.messages), []);
    otherUser.socket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-one",
        userId: "github:member",
        deviceId: "member-device-1",
        displayName: "Member"
      })
    );
    await delay(25);

    const firstHostConnection = await joinAndCollect("github:host", "host-device-1");
    assert.deepEqual(inviteNotifications(firstHostConnection.messages), [
      { type: "invite.requested", inviteId: "invite-pending", requestId: "request-pending" }
    ]);
    assert.deepEqual(
      firstHostConnection.messages.map((message) => message.type),
      ["mls.message", "invite.requested", "presence", "joined"],
      "retained MLS state and pending invites must precede the joined recovery barrier"
    );
    firstHostConnection.socket.close();

    const rejoinedHost = await joinAndCollect("github:host", "host-device-1");
    assert.deepEqual(
      inviteNotifications(rejoinedHost.messages),
      [{ type: "invite.requested", inviteId: "invite-pending", requestId: "request-pending" }],
      "a reconnect replays the still-pending request without replaying responded or other-room requests"
    );

    async function joinAndCollect(userId: string, deviceId: string) {
      const socket = new WebSocket(relay.wsUrl);
      sockets.push(socket);
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Record<string, unknown>));
      await onceOpen(socket);
      const joined = waitForJoined(socket);
      socket.send(
        JSON.stringify({
          type: "join",
          teamId: "team-core",
          roomId: "room-one",
          userId,
          deviceId
        })
      );
      await joined;
      await delay(50);
      return { socket, messages };
    }
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

function inviteNotifications(messages: Array<Record<string, unknown>>) {
  return messages.filter((message) => message.type === "invite.requested");
}

function inviteReplayFixture() {
  const request = (requestId: string, inviteId: string, roomId: string) => ({
    requestId,
    inviteId,
    requesterUserId: "github:joiner",
    requesterDeviceId: "joiner-device-1",
    keyPackageId: `kp-${requestId}`,
    keyPackageHash,
    sealedRequest: JSON.stringify({
      version: 3,
      binding: {
        version: 3,
        phase: "request",
        inviteId,
        teamId: "team-core",
        roomId,
        keyEpoch: 0,
        keyPackageHash,
        requestId,
        requestNonce: `nonce-${requestId}`,
        requesterUserId: "github:joiner",
        requesterDeviceId: "joiner-device-1",
        hostUserId: "github:host",
        hostDeviceId: "host-device-1",
        expiresAt,
        status: null,
        decidedAt: null
      },
      sealedPayload: {
        version: 1,
        kem_id: 16,
        kdf_id: 1,
        aead_id: 1,
        encapsulated_key: Array(65).fill(1),
        ciphertext: Array(16).fill(2)
      }
    }),
    createdAt
  });
  return {
    version: 1 as const,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core", members: 3 }],
    rooms: [room("room-one"), room("room-other")],
    invites: [
      invite("invite-pending", "room-one"),
      invite("invite-responded", "room-one"),
      invite("invite-other", "room-other")
    ],
    inviteRequests: [
      request("request-pending", "invite-pending", "room-one"),
      request("request-responded", "invite-responded", "room-one"),
      request("request-other", "invite-other", "room-other")
    ],
    inviteResponses: [respondedInvite()],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { teamId: "team-core", userId: "github:host", role: "owner", joinedAt: createdAt },
          { teamId: "team-core", userId: "github:member", role: "member", joinedAt: createdAt },
          { teamId: "team-core", userId: "github:joiner", role: "member", joinedAt: createdAt }
        ]
      }
    ],
    encryptedBacklog: [],
    mlsBacklog: [
      {
        key: "team-core:room-one",
        messages: [
          {
            id: "message-retained",
            teamId: "team-core",
            roomId: "room-one",
            senderUserId: "github:member",
            senderDeviceId: "member-device-1",
            createdAt,
            messageType: "application",
            epochHint: 0,
            mlsMessage: "AA=="
          }
        ]
      }
    ]
  };
}

function room(id: string) {
  return {
    id,
    teamId: "team-core",
    name: id,
    projectPath: "/tmp/replay",
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "host-device-1",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: { chat: true, code: true, workspace: true, browser: false },
    codexModel: "gpt-5.4",
    browserAllowedOrigins: [],
    browserProfilePersistent: false,
    unread: 0
  };
}

function invite(id: string, roomId: string) {
  return { id, teamId: "team-core", roomId, createdAt, expiresAt };
}

function respondedInvite() {
  return {
    requestId: "request-responded",
    inviteId: "invite-responded",
    requesterUserId: "github:joiner",
    requesterDeviceId: "joiner-device-1",
    keyPackageHash,
    status: "denied",
    responseBinding: {
      version: 3,
      phase: "response",
      inviteId: "invite-responded",
      teamId: "team-core",
      roomId: "room-one",
      keyEpoch: 0,
      keyPackageHash,
      requestId: "request-responded",
      requestNonce: "nonce-responded",
      requesterUserId: "github:joiner",
      requesterDeviceId: "joiner-device-1",
      hostUserId: "github:host",
      hostDeviceId: "host-device-1",
      expiresAt,
      status: "denied",
      decidedAt: createdAt
    },
    responseMac: "AA==",
    createdAt
  };
}

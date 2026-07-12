import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  encryptJson,
  sealJsonToDevice
} from "@multaiplayer/crypto";
import { WebSocket, onceOpen, startRelay, waitForEnvelope, waitForJoined } from "./support/relay.js";

const teamId = "team-core";
let roomId = "";
const hostUserId = "github:maddiedreese";
const hostDeviceId = "journey-host-device";
const memberUserId = "github:tester";
const memberDeviceId = "journey-member-device";

test("real relay process keeps create, invite, rotate, and remove lifecycle plaintext-free", async () => {
  const corpus = JSON.parse(
    await readFile(new URL("../../desktop/test/fixtures/injection-red-team-v1.json", import.meta.url), "utf8")
  ) as { plaintextMarkers: string[] };
  const markers = corpus.plaintextMarkers;
  assert.ok(markers.length >= 3, "security corpus must retain several independent leak markers");

  const relay = await startRelay(
    { MULTAIPLAYER_RELAY_STORAGE: "json", MULTAIPLAYER_RELAY_SEED_DEMO: "false" },
    {
      version: 1,
      savedAt: "2026-07-12T00:00:00.000Z",
      teams: [{ id: teamId, name: "Journey team", members: 2 }],
      rooms: [],
      invites: [],
      teamMembers: [
        {
          teamId,
          members: [
            { userId: hostUserId, role: "owner", joinedAt: "2026-07-12T00:00:00.000Z" },
            { userId: memberUserId, role: "member", joinedAt: "2026-07-12T00:00:00.000Z" }
          ],
          userIds: [hostUserId, memberUserId]
        }
      ],
      encryptedBacklog: []
    }
  );
  const host = new WebSocket(relay.wsUrl);
  const member = new WebSocket(relay.wsUrl);
  const transmitted: string[] = [];
  const httpArtifacts: string[] = [];
  host.on("message", (frame) => transmitted.push(frame.toString()));
  member.on("message", (frame) => transmitted.push(frame.toString()));

  try {
    await Promise.all([onceOpen(host), onceOpen(member)]);
    const createResponse = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId, name: "Journey room", projectPath: "/tmp/journey" })
    });
    const createBody = await createResponse.text();
    httpArtifacts.push(createBody);
    assert.equal(createResponse.status, 201);
    roomId = (JSON.parse(createBody) as { room: { id: string } }).room.id;
    assert.match(roomId, /^room_/);

    const hostResponse = await fetch(`${relay.baseUrl}/rooms/${roomId}/host`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "Journey host", hostUserId, hostStatus: "active" })
    });
    const hostBody = await hostResponse.text();
    httpArtifacts.push(hostBody);
    assert.equal(hostResponse.status, 200);

    const inviteResponse = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId, roomId })
    });
    const inviteBody = await inviteResponse.text();
    httpArtifacts.push(inviteBody);
    assert.equal(inviteResponse.status, 201);
    const inviteId = (JSON.parse(inviteBody) as { invite: { id: string; roomId: string } }).invite.id;
    assert.match(inviteId, /^invite_/);

    const hostJoined = waitForJoined(host);
    host.send(JSON.stringify({ type: "join", teamId, roomId, userId: hostUserId, deviceId: hostDeviceId }));
    await hostJoined;
    const memberJoined = waitForJoined(member);
    member.send(
      JSON.stringify({ type: "join", teamId, roomId, userId: memberUserId, deviceId: memberDeviceId, inviteId })
    );
    await memberJoined;

    const epochOne = await createRoomSecret();
    const memberIdentity = await createDeviceKeyAgreementIdentity();
    const created = await encryptedEnvelope("journey-create", "chat.message", 1, epochOne, {
      action: "create",
      marker: markers[0]
    });
    await publishAndObserve(host, member, created);

    const inviteMetadata = envelopeMetadata("journey-invite", "room.invite", 1);
    const invite = {
      ...inviteMetadata,
      payload: await sealJsonToDevice({ action: "invite", marker: markers[1] }, memberIdentity.publicKeyJwk, {
        purpose: "invite-request",
        teamId,
        roomId,
        senderUserId: hostUserId,
        senderDeviceId: hostDeviceId,
        recipientDeviceId: memberDeviceId
      })
    };
    await publishAndObserve(host, member, invite);

    const epochTwo = await createRoomSecret();
    const rotated = await encryptedEnvelope("journey-rotate", "room.key", 1, epochOne, {
      action: "rotate-before-remove",
      nextEpochSecret: epochTwo,
      markers: markers.slice(1)
    });
    await publishAndObserve(host, member, rotated);

    const removal = await fetch(`${relay.baseUrl}/teams/${teamId}/members/${encodeURIComponent(memberUserId)}`, {
      method: "DELETE"
    });
    const removalBody = await removal.text();
    httpArtifacts.push(removalBody);
    assert.equal(removal.status, 200);
    assert.equal(host.readyState, WebSocket.OPEN, "removing the member must not disconnect the host");

    await relay.close({ preserveData: true });
    const persisted = await readFile(relay.dataPath);
    const relayVisible = `${httpArtifacts.join("\n")}\n${transmitted.join("\n")}\n${persisted.toString("utf8")}`;
    for (const marker of markers) {
      assert.equal(relayVisible.includes(marker), false, `relay-visible lifecycle data leaked marker: ${marker}`);
    }
  } finally {
    host.close();
    member.close();
    await relay.close();
  }
});

function envelopeMetadata(id: string, kind: "chat.message" | "room.invite" | "room.key", keyEpoch: number) {
  return {
    id,
    teamId,
    roomId,
    senderUserId: hostUserId,
    senderDeviceId: hostDeviceId,
    createdAt: new Date().toISOString(),
    kind,
    keyEpoch
  };
}

async function encryptedEnvelope(
  id: string,
  kind: "chat.message" | "room.key",
  keyEpoch: number,
  key: Awaited<ReturnType<typeof createRoomSecret>>,
  plaintext: unknown
) {
  const metadata = envelopeMetadata(id, kind, keyEpoch);
  return { ...metadata, payload: await encryptJson(plaintext, key, metadata) };
}

async function publishAndObserve(
  sender: WebSocket,
  receiver: WebSocket,
  envelope: ReturnType<typeof envelopeMetadata> & { payload: unknown }
) {
  const observed = waitForEnvelope(receiver, envelope.kind);
  sender.send(JSON.stringify({ type: "publish", envelope }));
  assert.equal((await observed).id, envelope.id);
}

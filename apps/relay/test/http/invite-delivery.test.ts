import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { InviteRecord, InviteResponseRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import { ackInviteResponseAtomically, isExactInviteAckReceipt } from "../../src/http/invite-delivery.js";
import { createRelayPersistence } from "../../src/persistence.js";
import { InMemoryRelayStore } from "../../src/state.js";

test("invite response ACK rolls back on persistence failure and retries atomically after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-invite-ack-"));
  const path = join(dir, "relay.sqlite");
  const initial = seededStore();
  let persistence = createRelayPersistence({ backend: "sqlite", dataPath: path });
  try {
    await persistence.save(snapshot(initial.store));
    assert.equal(
      await ackInviteResponseAtomically(initial.store, initial.response, async () => {
        throw new Error("injected persistence failure");
      }),
      "persistence_failed"
    );
    assert.equal(initial.store.inviteResponses.has(initial.response.requestId), true);
    assert.equal(initial.store.getInvite(initial.invite.id)?.id, initial.invite.id);
    assert.equal(initial.store.hasTeamMember("team-core", "github:joiner"), false);
    assert.equal(initial.store.getTeam("team-core")?.members, 1);

    persistence.close();
    persistence = createRelayPersistence({ backend: "sqlite", dataPath: path });
    const afterFailure = (await persistence.load()) as PersistedFixture;
    assert.equal(afterFailure.inviteResponses.length, 1);
    assert.equal(afterFailure.invites.length, 1);
    assert.deepEqual(memberIds(afterFailure), ["github:host"]);

    const restarted = hydrate(afterFailure);
    const restartedResponse = restarted.inviteResponses.get(initial.response.requestId);
    assert.ok(restartedResponse);
    const persistedInvite = restarted.getInvite(initial.invite.id);
    assert.ok(persistedInvite);
    restarted.deleteInvite(initial.invite.id);
    assert.equal(await ackInviteResponseAtomically(restarted, restartedResponse, async () => {}), "revoked");
    assert.equal(restarted.hasTeamMember("team-core", "github:joiner"), false);
    assert.equal(restarted.inviteResponses.has(initial.response.requestId), true);
    restarted.setInvite(persistedInvite);
    assert.equal(
      await ackInviteResponseAtomically(restarted, restartedResponse, () => persistence.save(snapshot(restarted))),
      "ok"
    );
    assert.equal(restarted.inviteResponses.size, 0);
    assert.equal(restarted.getInvite(initial.invite.id), undefined);
    assert.equal(restarted.hasTeamMember("team-core", "github:joiner"), true);
    assert.equal(restarted.getTeam("team-core")?.members, 2);

    persistence.close();
    persistence = createRelayPersistence({ backend: "sqlite", dataPath: path });
    const afterRetry = (await persistence.load()) as PersistedFixture;
    assert.equal(afterRetry.inviteResponses.length, 0);
    assert.equal(afterRetry.invites.length, 0);
    assert.equal(afterRetry.inviteAckReceipts.length, 1);
    assert.deepEqual(memberIds(afterRetry).sort(), ["github:host", "github:joiner"]);
    const acknowledgedRestart = hydrate(afterRetry);
    assert.equal(
      isExactInviteAckReceipt(
        acknowledgedRestart,
        initial.invite.id,
        initial.response.requestId,
        "github:joiner",
        "device-joiner"
      ),
      true
    );
    assert.equal(
      isExactInviteAckReceipt(
        acknowledgedRestart,
        initial.invite.id,
        initial.response.requestId,
        "github:joiner",
        "device-mismatch"
      ),
      false
    );
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("denied invite ACK deletes the dead capability, persists a retry receipt, and never admits", async () => {
  const { store, invite, response: approved } = seededStore();
  const inviteWithoutApproval: InviteRecord = {
    id: invite.id,
    teamId: invite.teamId,
    roomId: invite.roomId,
    createdAt: invite.createdAt
  };
  const denied: InviteResponseRecord = {
    ...approved,
    status: "denied",
    responseBinding: { ...approved.responseBinding, status: "denied" },
    welcome: undefined
  };
  store.setInvite(inviteWithoutApproval);
  store.inviteResponses.clear();
  store.inviteResponses.set(denied.requestId, denied);

  assert.equal(
    await ackInviteResponseAtomically(store, denied, async () => {
      throw new Error("injected persistence failure");
    }),
    "persistence_failed"
  );
  assert.equal(store.inviteResponses.has(denied.requestId), true);
  assert.equal(store.getInvite(invite.id)?.id, invite.id);
  assert.equal(store.inviteAckReceipts.size, 0);
  assert.equal(store.hasTeamMember("team-core", "github:joiner"), false);

  assert.equal(await ackInviteResponseAtomically(store, denied, async () => undefined), "ok");
  assert.equal(store.inviteResponses.size, 0);
  assert.equal(store.getInvite(invite.id), undefined);
  assert.equal(store.hasTeamMember("team-core", "github:joiner"), false);
  assert.equal(store.inviteAckReceipts.get(denied.requestId)?.status, "denied");
  assert.equal(isExactInviteAckReceipt(store, invite.id, denied.requestId, "github:joiner", "device-joiner"), true);
});

interface PersistedFixture {
  teams: TeamRecord[];
  invites: InviteRecord[];
  inviteResponses: InviteResponseRecord[];
  inviteAckReceipts: Array<{
    inviteId: string;
    requestId: string;
    teamId: string;
    requesterUserId: string;
    requesterDeviceId: string;
    keyPackageHash: string;
    status: "approved" | "denied";
    acknowledgedAt: string;
    expiresAt: string;
  }>;
  teamMembers: Array<{ teamId: string; members: TeamMemberRecord[] }>;
}

function seededStore() {
  const store = new InMemoryRelayStore();
  const createdAt = "2026-07-12T12:00:00.000Z";
  const team: TeamRecord = { id: "team-core", name: "Core", members: 1 };
  const invite: InviteRecord = {
    id: "invite-one",
    teamId: team.id,
    roomId: "room-one",
    approvedUserId: "github:joiner",
    approvedDeviceId: "device-joiner",
    keyPackageHash: `sha256:${"a".repeat(64)}`,
    createdAt
  };
  const response: InviteResponseRecord = {
    requestId: "request-one",
    inviteId: invite.id,
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-joiner",
    keyPackageHash: invite.keyPackageHash!,
    status: "approved",
    responseBinding: {
      version: 3,
      phase: "response",
      inviteId: invite.id,
      teamId: team.id,
      roomId: invite.roomId,
      keyEpoch: 1,
      keyPackageHash: invite.keyPackageHash!,
      requestId: "request-one",
      requestNonce: "nonce-one",
      requesterUserId: "github:joiner",
      requesterDeviceId: "device-joiner",
      hostUserId: "github:host",
      hostDeviceId: "device-host",
      expiresAt: "2026-07-13T12:00:00.000Z",
      status: "approved",
      decidedAt: createdAt
    },
    responseMac: "AA==",
    welcome: "AA==",
    createdAt
  };
  store.setTeam(team);
  store.setTeamMembers(
    team.id,
    new Map([["github:host", { teamId: team.id, userId: "github:host", role: "owner", joinedAt: createdAt }]])
  );
  store.setInvite(invite);
  store.inviteResponses.set(response.requestId, response);
  return { store, invite, response };
}

function snapshot(store: InMemoryRelayStore) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: store.allTeams(),
    rooms: store.allRooms(),
    invites: Array.from(store.invites.values()),
    devices: Array.from(store.devices.values()),
    keyPackages: Array.from(store.keyPackages.values()),
    inviteRequests: Array.from(store.inviteRequests.values()),
    inviteResponses: Array.from(store.inviteResponses.values()),
    inviteAckReceipts: Array.from(store.inviteAckReceipts.values()),
    acceptedMessageReceipts: Array.from(store.acceptedMessageReceipts.values()),
    teamMembers: Array.from(store.teamMembers, ([teamId, members]) => ({
      teamId,
      members: Array.from(members.values())
    })),
    authSessions: [],
    attachmentBlobs: [],
    mlsBacklog: []
  };
}

function hydrate(value: PersistedFixture): InMemoryRelayStore {
  const store = new InMemoryRelayStore();
  for (const team of value.teams) store.setTeam(team);
  for (const invite of value.invites) store.setInvite(invite);
  for (const response of value.inviteResponses) store.inviteResponses.set(response.requestId, response);
  for (const receipt of value.inviteAckReceipts) store.inviteAckReceipts.set(receipt.requestId, receipt);
  for (const entry of value.teamMembers) {
    store.setTeamMembers(entry.teamId, new Map(entry.members.map((member) => [member.userId, member])));
  }
  return store;
}

function memberIds(value: PersistedFixture): string[] {
  return value.teamMembers.flatMap((entry) => entry.members.map((member) => member.userId));
}

import { test } from "node:test";
import { assert, debugRelayState, startRelay } from "../support/relay.js";

test("relay creates invite metadata with expiry", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_INVITE_TTL_DAYS: "3" });
  try {
    const response = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      invite: { createdAt: string; expiresAt?: string };
    };
    assert.ok(body.invite.expiresAt);
    assert.ok(Date.parse(body.invite.expiresAt) > Date.parse(body.invite.createdAt));
  } finally {
    await relay.close();
  }
});

test("relay revokes every outstanding invite for a room", async () => {
  const relay = await startRelay();
  try {
    const create = () =>
      fetch(`${relay.baseUrl}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
      });
    const first = (await (await create()).json()) as { invite: { id: string } };
    const second = (await (await create()).json()) as { invite: { id: string } };

    const revoked = await fetch(`${relay.baseUrl}/teams/team-core/rooms/room-desktop/invites`, { method: "DELETE" });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { revoked: 2 });
    assert.equal((await fetch(`${relay.baseUrl}/invites/${first.invite.id}`)).status, 404);
    assert.equal((await fetch(`${relay.baseUrl}/invites/${second.invite.id}`)).status, 404);
  } finally {
    await relay.close();
  }
});

test("relay rejects expired invite metadata loaded from store", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
          projectPath: "/tmp/multaiplayer",
          host: "No host",
          hostStatus: "offline",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        }
      ],
      invites: [
        {
          id: "invite_expired",
          teamId: "team-core",
          roomId: "room-desktop",
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const response = await fetch(`${relay.baseUrl}/invites/invite_expired`);
    assert.equal(response.status, 404);
  } finally {
    await relay.close();
  }
});

test("relay drops invalid persisted invite metadata", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
          projectPath: "/tmp/multaiplayer",
          host: "No host",
          hostStatus: "offline",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        }
      ],
      invites: [
        {
          id: "invite_live",
          teamId: "team-core",
          roomId: "room-desktop",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "invite:bad",
          teamId: "team-core",
          roomId: "room-desktop",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "invite_orphan",
          teamId: "team-core",
          roomId: "room-missing",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "invite_bad_time",
          teamId: "team-core",
          roomId: "room-desktop",
          createdAt: "not a date",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const debug = await debugRelayState(relay.baseUrl);
    assert.equal(debug.invites, 1);

    const live = await fetch(`${relay.baseUrl}/invites/invite_live`);
    assert.equal(live.status, 200);
    const bad = await fetch(`${relay.baseUrl}/invites/invite%3Abad`);
    assert.equal(bad.status, 404);
    const orphan = await fetch(`${relay.baseUrl}/invites/invite_orphan`);
    assert.equal(orphan.status, 404);
    const badTime = await fetch(`${relay.baseUrl}/invites/invite_bad_time`);
    assert.equal(badTime.status, 404);
  } finally {
    await relay.close();
  }
});

test("relay prunes expired in-memory invites and attachment blobs", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
          projectPath: "/tmp/multaiplayer",
          host: "No host",
          hostStatus: "offline",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        }
      ],
      invites: [
        {
          id: "invite_live",
          teamId: "team-core",
          roomId: "room-desktop",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      attachmentBlobs: [
        {
          id: "blob_expired",
          teamId: "team-core",
          roomId: "room-desktop",
          name: "expired.txt",
          type: "text/plain",
          size: 4,
          payload: {
            algorithm: "AES-GCM-256",
            nonce: "nonce-for-test",
            ciphertext: "ciphertext-for-test"
          },
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const debug = await debugRelayState(relay.baseUrl);
    assert.equal(debug.invites, 1);
    assert.equal(debug.attachmentBlobs, 0);
  } finally {
    await relay.close();
  }
});

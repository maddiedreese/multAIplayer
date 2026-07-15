import { createECDH, createHash, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { assert, createDebugSession, debugRelayState, startRelay } from "../support/relay.js";

test("invite lookup exposes only the pinned active-host public identity to non-members", async () => {
  const relay = await startRelay();
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const signaturePublicKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .publicKey.export({ format: "der", type: "spki" })
      .toString("base64");
    const hpke = createECDH("prime256v1");
    hpke.generateKeys();
    const hpkePublicKey = hpke.getPublicKey(undefined, "uncompressed").toString("base64");
    const register = await fetch(`${relay.baseUrl}/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        deviceId: "host-device-1",
        signaturePublicKey,
        signatureKeyFingerprint: fingerprint(signaturePublicKey),
        hpkePublicKey,
        hpkeKeyFingerprint: fingerprint(hpkePublicKey)
      })
    });
    assert.equal(register.status, 201);

    const created = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(created.status, 201);
    const { invite } = (await created.json()) as { invite: { id: string; creatorUserId?: string } };
    assert.equal(invite.creatorUserId, "github:maddiedreese");

    // No member cookie: possession of the relay invite id reveals only the
    // exact public identity needed to verify the protected invite fragment.
    const lookup = await fetch(`${relay.baseUrl}/invites/${invite.id}`);
    assert.equal(lookup.status, 200);
    const body = (await lookup.json()) as { invite: Record<string, unknown>; hostDevice: Record<string, unknown> };
    assert.equal("creatorUserId" in body.invite, false);
    assert.deepEqual(body.hostDevice, {
      userId: "github:maddiedreese",
      deviceId: "host-device-1",
      signaturePublicKey,
      signatureKeyFingerprint: fingerprint(signaturePublicKey),
      hpkePublicKey,
      hpkeKeyFingerprint: fingerprint(hpkePublicKey)
    });
    assert.equal("displayName" in body.hostDevice, false);
    assert.equal("lastSeenAt" in body.hostDevice, false);
  } finally {
    await relay.close();
  }
});

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

function fingerprint(encoded: string) {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)!.join(":")}`;
}

import test from "node:test";
import { assert, createDebugSession, startRelayWithWorkspace } from "../support/relay.js";

test("relay stores only opaque exporter-sealed attachment blobs", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    const marker = "relay-must-not-see-attachment-plaintext";
    const sealedBlob = JSON.stringify({
      version: 1,
      epoch: 0,
      nonce: Buffer.alloc(12, 1).toString("base64"),
      ciphertext: Buffer.from(`cipher:${marker}`).toString("base64")
    });
    const response = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blobId: "blob-client-one",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "asset",
        type: "file",
        size: 32,
        epoch: 0,
        sealedBlob
      })
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { blob: { id: string; sealedBlob: string } };
    assert.equal(body.blob.sealedBlob, sealedBlob);
    assert.equal(JSON.stringify(body).includes(marker), false);
    const fetched = await fetch(
      `${relay.baseUrl}/attachment-blobs/${body.blob.id}?teamId=team-core&roomId=room-desktop`
    );
    assert.equal(fetched.status, 200);
    const replay = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blobId: "blob-client-one",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "late",
        type: "file",
        size: 32,
        epoch: 0,
        sealedBlob
      })
    });
    assert.equal(replay.status, 409);
    const crossRoom = await fetch(
      `${relay.baseUrl}/attachment-blobs/${body.blob.id}?teamId=team-core&roomId=room-relay`
    );
    assert.equal(crossRoom.status, 404);
  } finally {
    await relay.close();
  }
});

test("relay rejects oversized sealed attachment blobs", async () => {
  const relay = await startRelayWithWorkspace({ MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "32" });
  try {
    const response = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blobId: "blob-client-two",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "asset",
        type: "file",
        size: 33,
        epoch: 0,
        sealedBlob: "AA=="
      })
    });
    assert.equal(response.status, 413);
  } finally {
    await relay.close();
  }
});

test("attachment byte quotas charge stored ciphertext rather than attacker-controlled declared size", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "1024",
    MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES: "1024",
    MULTAIPLAYER_ATTACHMENT_BLOB_TEAM_LIVE_QUOTA_BYTES: "1024"
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const sealedBlob = JSON.stringify({
      version: 1,
      epoch: 0,
      nonce: Buffer.alloc(12, 1).toString("base64"),
      ciphertext: Buffer.alloc(900, 2).toString("base64")
    });
    const response = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        blobId: "blob-byte-accounting",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "asset",
        type: "file",
        size: 1,
        epoch: 0,
        sealedBlob
      })
    });
    assert.equal(response.status, 413);
    assert.equal(((await response.json()) as { quota: { type: string } }).quota.type, "live_attachment_blob_bytes");
  } finally {
    await relay.close();
  }
});

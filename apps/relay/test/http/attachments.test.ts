import { test } from "node:test";
import { assert, createDebugSession, debugRelayState, maxEnvelopeNonceChars, startRelay } from "../support/relay.js";

test("relay stores encrypted attachment blobs as ciphertext", async () => {
  const relay = await startRelay({ MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS: "2" });
  try {
    const response = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "large-file.ts",
        type: "text/typescript",
        size: 120000,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "ciphertext-without-plaintext"
        }
      })
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as {
      blob: { id: string; payload: { algorithm: string; ciphertext: string }; expiresAt?: string };
    };
    assert.match(created.blob.id, /^blob_/);
    assert.equal(created.blob.payload.algorithm, "AES-GCM-256");
    assert.equal(created.blob.payload.ciphertext, "ciphertext-without-plaintext");
    assert.ok(created.blob.expiresAt);

    const missingScopeResponse = await fetch(`${relay.baseUrl}/attachment-blobs/${created.blob.id}`);
    assert.equal(missingScopeResponse.status, 400);

    const wrongScopeResponse = await fetch(
      `${relay.baseUrl}/attachment-blobs/${created.blob.id}?teamId=team-core&roomId=room-other`
    );
    assert.equal(wrongScopeResponse.status, 404);
    const wrongScopeBody = await wrongScopeResponse.text();
    assert.doesNotMatch(wrongScopeBody, /large-file\.ts/);
    assert.doesNotMatch(wrongScopeBody, /ciphertext-without-plaintext/);

    const loadedResponse = await fetch(
      `${relay.baseUrl}/attachment-blobs/${created.blob.id}?teamId=team-core&roomId=room-desktop`
    );
    assert.equal(loadedResponse.status, 200);
    const loaded = (await loadedResponse.json()) as {
      blob: { name: string; payload: { ciphertext: string } };
    };
    assert.equal(loaded.blob.name, "large-file.ts");
    assert.equal(loaded.blob.payload.ciphertext, "ciphertext-without-plaintext");
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated live encrypted attachment blob quotas", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "10",
    MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES: "10"
  });
  try {
    const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const alexCookie = await createDebugSession(relay.baseUrl, "github:alex", "alex");
    const uploadBody = (size: number, name: string) => ({
      teamId: "team-core",
      roomId: "room-desktop",
      name,
      type: "text/plain",
      size,
      payload: {
        version: 2,
        algorithm: "AES-GCM-256",
        nonce: "nonce-for-test",
        ciphertext: "tiny"
      }
    });

    const first = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify(uploadBody(6, "one.txt"))
    });
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as { blob: { uploadedByUserId?: string } };
    assert.equal(firstBody.blob.uploadedByUserId, "github:maddiedreese");

    const limited = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify(uploadBody(5, "two.txt"))
    });
    assert.equal(limited.status, 413);
    const limitedBody = (await limited.json()) as {
      error: string;
      code: string;
      quota: { type: string; limit: number; used: number; remaining: number };
    };
    assert.equal(limitedBody.error, "Live encrypted attachment blob storage quota exceeded.");
    assert.equal(limitedBody.code, "quota_exceeded");
    assert.deepEqual(limitedBody.quota, {
      type: "live_attachment_blob_bytes",
      limit: 10,
      used: 6,
      remaining: 4
    });

    const otherUser = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alexCookie },
      body: JSON.stringify(uploadBody(5, "alex.txt"))
    });
    assert.equal(otherUser.status, 201);

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const metricsBody = (await metrics.json()) as {
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(metricsBody.quotaRejectionsTotal, 1);
    assert.equal(metricsBody.quotaRejectionsByType?.live_attachment_blob_bytes, 1);
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated encrypted attachment upload byte quotas", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "10",
    MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES: "100",
    MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW: "10",
    MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_WINDOW_MS: "60000"
  });
  try {
    const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const uploadBody = (size: number, name: string) => ({
      teamId: "team-core",
      roomId: "room-desktop",
      name,
      type: "text/plain",
      size,
      payload: {
        version: 2,
        algorithm: "AES-GCM-256",
        nonce: "nonce-for-test",
        ciphertext: "tiny"
      }
    });

    const first = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify(uploadBody(6, "one.txt"))
    });
    assert.equal(first.status, 201);

    const limited = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify(uploadBody(5, "two.txt"))
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    const limitedBody = (await limited.json()) as {
      error: string;
      code: string;
      retryAfterSeconds: number;
      quota: { type: string; limit: number; used: number; remaining: number; resetsAt: string };
    };
    assert.equal(limitedBody.error, "Encrypted attachment blob upload byte quota exceeded.");
    assert.equal(limitedBody.code, "quota_exceeded");
    assert.equal(limitedBody.retryAfterSeconds, 60);
    assert.deepEqual(limitedBody.quota, {
      type: "attachment_blob_upload_bytes",
      limit: 10,
      used: 6,
      remaining: 4,
      resetsAt: limitedBody.quota.resetsAt
    });
    assert.ok(Number.isFinite(Date.parse(limitedBody.quota.resetsAt)));

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const metricsBody = (await metrics.json()) as {
      liveAttachmentBlobCount?: unknown;
      liveAttachmentBlobBytes?: unknown;
      attachmentBlobUploadsTotal?: unknown;
      attachmentBlobUploadBytesTotal?: unknown;
      attachmentBlobUploadRejectionsByReason?: Record<string, unknown>;
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(metricsBody.liveAttachmentBlobCount, 1);
    assert.equal(metricsBody.liveAttachmentBlobBytes, 6);
    assert.equal(metricsBody.attachmentBlobUploadsTotal, 1);
    assert.equal(metricsBody.attachmentBlobUploadBytesTotal, 6);
    assert.equal(metricsBody.attachmentBlobUploadRejectionsByReason?.upload_byte_quota, 1);
    assert.equal(metricsBody.quotaRejectionsTotal, 1);
    assert.equal(metricsBody.quotaRejectionsByType?.attachment_blob_upload_bytes, 1);
  } finally {
    await relay.close();
  }
});

test("relay enforces encrypted attachment blob size limits", async () => {
  const relay = await startRelay({ MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "16" });
  try {
    const controlName = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "bad\nname.txt",
        type: "text/plain",
        size: 4,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "ciphertext"
        }
      })
    });
    assert.equal(controlName.status, 400);
    assert.match(await controlName.text(), /name must be/);

    const controlType = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "file.txt",
        type: "text\nplain",
        size: 4,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "ciphertext"
        }
      })
    });
    assert.equal(controlType.status, 400);
    assert.match(await controlType.text(), /type must be/);

    const protocolBoundaryNonce = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "protocol-boundary-nonce.txt",
        type: "text/plain",
        size: 4,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "x".repeat(maxEnvelopeNonceChars),
          ciphertext: "ciphertext"
        }
      })
    });
    assert.equal(protocolBoundaryNonce.status, 201);

    const oversizedNonce = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "bad-nonce.txt",
        type: "text/plain",
        size: 4,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "x".repeat(maxEnvelopeNonceChars + 1),
          ciphertext: "ciphertext"
        }
      })
    });
    assert.equal(oversizedNonce.status, 400);
    assert.match(await oversizedNonce.text(), /valid ciphertext payload/);

    const oversizedDeclared = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "too-large.txt",
        type: "text/plain",
        size: 17,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "short-ciphertext"
        }
      })
    });
    assert.equal(oversizedDeclared.status, 413);
    assert.match(await oversizedDeclared.text(), /exceeds 16 bytes/);

    const oversizedCiphertext = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "huge-ciphertext.txt",
        type: "text/plain",
        size: 8,
        payload: {
          version: 2,
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "x".repeat(1500)
        }
      })
    });
    assert.equal(oversizedCiphertext.status, 413);
    assert.match(await oversizedCiphertext.text(), /ciphertext exceeds 16 bytes/);
  } finally {
    await relay.close();
  }
});

test("relay drops invalid persisted attachment blob metadata", async () => {
  const relay = await startRelay(
    { MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "16" },
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
      invites: [],
      attachmentBlobs: [
        {
          id: "blob_live",
          teamId: "team-core",
          roomId: "room-desktop",
          name: "live.txt",
          type: "text/plain",
          size: 4,
          payload: {
            version: 2,
            algorithm: "AES-GCM-256",
            nonce: "nonce-for-test",
            ciphertext: "ciphertext"
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "blob:bad",
          teamId: "team-core",
          roomId: "room-desktop",
          name: "bad-id.txt",
          type: "text/plain",
          size: 4,
          payload: {
            version: 2,
            algorithm: "AES-GCM-256",
            nonce: "nonce-for-test",
            ciphertext: "ciphertext"
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "blob_orphan",
          teamId: "team-core",
          roomId: "room-missing",
          name: "orphan.txt",
          type: "text/plain",
          size: 4,
          payload: {
            version: 2,
            algorithm: "AES-GCM-256",
            nonce: "nonce-for-test",
            ciphertext: "ciphertext"
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "blob_huge",
          teamId: "team-core",
          roomId: "room-desktop",
          name: "huge.txt",
          type: "text/plain",
          size: 8,
          payload: {
            version: 2,
            algorithm: "AES-GCM-256",
            nonce: "nonce-for-test",
            ciphertext: "x".repeat(1500)
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "blob_bad_nonce",
          teamId: "team-core",
          roomId: "room-desktop",
          name: "bad-nonce.txt",
          type: "text/plain",
          size: 4,
          payload: {
            version: 2,
            algorithm: "AES-GCM-256",
            nonce: "x".repeat(maxEnvelopeNonceChars + 1),
            ciphertext: "ciphertext"
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const debug = await debugRelayState(relay.baseUrl);
    assert.equal(debug.attachmentBlobs, 1);

    const live = await fetch(`${relay.baseUrl}/attachment-blobs/blob_live?teamId=team-core&roomId=room-desktop`);
    assert.equal(live.status, 200);
    const bad = await fetch(`${relay.baseUrl}/attachment-blobs/blob%3Abad?teamId=team-core&roomId=room-desktop`);
    assert.equal(bad.status, 404);
    const orphan = await fetch(`${relay.baseUrl}/attachment-blobs/blob_orphan?teamId=team-core&roomId=room-missing`);
    assert.equal(orphan.status, 404);
    const huge = await fetch(`${relay.baseUrl}/attachment-blobs/blob_huge?teamId=team-core&roomId=room-desktop`);
    assert.equal(huge.status, 404);
    const badNonce = await fetch(
      `${relay.baseUrl}/attachment-blobs/blob_bad_nonce?teamId=team-core&roomId=room-desktop`
    );
    assert.equal(badNonce.status, 404);
  } finally {
    await relay.close();
  }
});

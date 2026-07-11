import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  dump(): string {
    return Array.from(this.values.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {}
});

const {
  acknowledgeRoomVisibilityWarning,
  clearEncryptedHistory,
  clearRoomVisibilityWarningAcknowledgement,
  forgetRoomLocalData,
  hasAcknowledgedRoomVisibilityWarning,
  importRoomSecret,
  installRoomSecretEpoch,
  clearPendingRoomRotation,
  clearWebPreviewRoomKeyringsForTests,
  loadEncryptedHistory,
  loadHistorySettings,
  loadRoomSecret,
  loadRoomKeyring,
  loadPendingRoomRotation,
  replaceRoomSecret,
  savePendingRoomRotation,
  roomVisibilityWarningKey,
  saveEncryptedHistory,
  saveHistorySettings
} = {
  ...(await import("../src/lib/localHistory")),
  ...(await import("../src/lib/roomVisibilityWarning"))
};

const { emptyLocalRoomHistoryPayload, normalizeLocalRoomHistory } = await import("../src/lib/localRoomHistoryPayload");
test.beforeEach(() => {
  localStorage.clear();
  clearWebPreviewRoomKeyringsForTests();
});

test("encrypted history stores no plaintext transcript while remaining recoverable", async () => {
  const roomId = "room-local-history";
  const payload = {
    version: 2,
    messages: [
      {
        id: "msg-secret",
        author: "Maddie",
        role: "human",
        body: "super secret room transcript",
        time: "10:00 AM"
      }
    ]
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /super secret room transcript/);
  assert.doesNotMatch(localStorage.dump(), /super secret room transcript/);

  await assert.doesNotReject(async () => {
    const restored = await loadEncryptedHistory<typeof payload>(roomId);
    assert.deepEqual(restored, payload);
  });
});

test("encrypted history keeps Codex thread continuity local and encrypted", async () => {
  const roomId = "room-codex-thread-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    codexThreadId: "thr_room_123"
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /thr_room_123/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("history normalization retains legacy records that predate strict live payload limits", () => {
  const normalized = normalizeLocalRoomHistory({
    ...emptyLocalRoomHistoryPayload(),
    inviteRequests: [
      {
        eventType: "invite.request",
        id: "invite-legacy",
        requester: "Peer",
        requesterUserId: "github:peer",
        requesterDeviceId: "device-peer",
        requestedAt: "legacy timestamp",
        status: "pending"
      }
    ],
    codexEvents: [
      {
        eventType: "codex.turn",
        turnId: "turn-legacy",
        status: "event",
        message: "Legacy event",
        model: "gpt-5.4",
        host: "Peer",
        hostUserId: "github:peer",
        createdAt: "legacy timestamp"
      }
    ],
    gitWorkflowEvents: [
      {
        eventType: "git.workflow",
        status: "completed",
        branch: "main",
        push: false,
        message: "Legacy workflow",
        runner: "Peer",
        runnerUserId: "github:peer",
        createdAt: "legacy timestamp"
      }
    ],
    githubActionsEvents: [
      {
        eventType: "github.actions",
        owner: "owner",
        repo: "repo",
        branch: "main",
        summary: { label: "Done", detail: "Legacy run", tone: "green" },
        message: "Legacy actions",
        checkedBy: "Peer",
        checkedByUserId: "github:peer",
        checkedAt: "legacy timestamp",
        runs: [
          {
            id: 1,
            name: "CI",
            status: "completed",
            conclusion: "success",
            url: "https://example.test/run/1",
            createdAt: "legacy timestamp",
            updatedAt: "legacy timestamp"
          }
        ]
      }
    ]
  });

  assert.equal(normalized.inviteRequests.length, 1);
  assert.equal(normalized.codexEvents.length, 1);
  assert.equal(normalized.gitWorkflowEvents.length, 1);
  assert.equal(normalized.githubActionsEvents.length, 1);
});

test("encrypted history keeps canonical Codex activity metadata encrypted", async () => {
  const roomId = "room-codex-activity-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    codexActivities: [
      {
        eventType: "codex.activity",
        activityId: "turn-1-item-1",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        status: "completed",
        title: "Command execution",
        startedAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:01.000Z",
        host: "Host",
        hostUserId: "user-host"
      }
    ],
    codexThreadId: "thread-child",
    codexThreadGraph: {
      activeThreadId: "thread-child",
      nodesById: {
        "thread-root": { id: "thread-root", title: "Root", status: "idle", createdAt: 1, updatedAt: 1 },
        "thread-child": {
          id: "thread-child",
          parentThreadId: "thread-root",
          title: "Branch",
          status: "idle",
          createdAt: 2,
          updatedAt: 2
        }
      }
    }
  };
  await saveEncryptedHistory(roomId, payload);
  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /Command execution|turn-1-item-1|thread-child|Branch/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("encrypted history keeps Codex turn risk flags local and encrypted", async () => {
  const roomId = "room-codex-risk-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [
      {
        eventType: "codex.turn",
        turnId: "turn-risk",
        status: "started",
        message: "Started Codex turn with GPT-5.5.",
        model: "gpt-5.5",
        consumedMessageIds: ["message-risk"],
        riskFlags: [
          {
            id: "message-risk",
            label: "message from Maddie contains agent-directed phrasing",
            source: "message from Maddie",
            risk: "Agent-directed phrasing",
            severity: "warning"
          }
        ],
        host: "Maddie",
        hostUserId: "github:maddie",
        createdAt: "2026-07-06T00:06:00.000Z"
      }
    ],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    terminalSnapshots: [],
    hostHandoffs: []
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /message-risk/);
  assert.doesNotMatch(stored, /agent-directed phrasing/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("encrypted history keeps local room read state encrypted", async () => {
  const roomId = "room-read-state-history";
  const payload = {
    version: 3,
    messages: [],
    readState: {
      lastReadMessageId: "message-last-read",
      unread: 3
    },
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: [
      {
        turnId: "turn-queued-1",
        roomId,
        requestedBy: "Maddie",
        requestedByUserId: "github:maddie",
        queuedAt: "2026-07-06T00:05:00.000Z"
      }
    ]
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /message-last-read/);
  assert.doesNotMatch(stored, /turn-queued-1/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("encrypted history keeps pre-Codex edit and delete audit records encrypted", async () => {
  const roomId = "room-edit-delete-audit-history";
  const payload = {
    version: 3,
    messages: [
      {
        id: "message-edited",
        author: "Maddie",
        authorUserId: "github:maddie",
        role: "human",
        body: "final visible message",
        time: "10:00 AM",
        createdAt: "2026-07-08T17:00:00.000Z",
        editedAt: "2026-07-08T17:01:00.000Z",
        editedByUserId: "github:maddie"
      },
      {
        id: "message-deleted",
        author: "Jordan",
        authorUserId: "github:jordan",
        role: "human",
        body: "",
        time: "10:01 AM",
        createdAt: "2026-07-08T17:01:00.000Z",
        deletedAt: "2026-07-08T17:02:00.000Z",
        deletedBy: "Jordan",
        deletedByUserId: "github:jordan"
      }
    ],
    chatEdits: [
      {
        id: "edit-secret",
        messageId: "message-edited",
        body: "private edited audit body",
        editedBy: "Maddie",
        editedByUserId: "github:maddie",
        editedAt: "2026-07-08T17:01:00.000Z"
      }
    ],
    chatDeletes: [
      {
        id: "delete-secret",
        messageId: "message-deleted",
        deletedBy: "Jordan",
        deletedByUserId: "github:jordan",
        deletedAt: "2026-07-08T17:02:00.000Z"
      }
    ],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: []
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /private edited audit body/);
  assert.doesNotMatch(stored, /edit-secret/);
  assert.doesNotMatch(stored, /delete-secret/);
  assert.doesNotMatch(localStorage.dump(), /message-deleted/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
  const normalized = normalizeLocalRoomHistory((await loadEncryptedHistory<typeof payload>(roomId)) ?? []);
  assert.equal(normalized.chatEdits?.[0]?.body, "private edited audit body");
  assert.equal(normalized.chatDeletes?.[0]?.deletedBy, "Jordan");
});

test("local history normalization preserves sanitized room read state", () => {
  const normalized = normalizeLocalRoomHistory({
    version: 3,
    messages: [],
    readState: {
      lastReadMessageId: " message-a ",
      unread: 1000
    },
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: [
      {
        turnId: "turn-queued-1",
        roomId: "room-a",
        requestedBy: "Maddie",
        requestedByUserId: "github:maddie",
        queuedAt: "2026-07-06T00:05:00.000Z",
        triggerMessageId: "message-a"
      }
    ]
  });

  assert.deepEqual(normalized.readState, {
    lastReadMessageId: "message-a",
    unread: 999
  });
  assert.equal(normalized.queuedCodexTurns?.[0]?.turnId, "turn-queued-1");
});

test("local history normalization preserves file save requests", () => {
  const payload = normalizeLocalRoomHistory({
    version: 3,
    messages: [],
    terminalRequests: [],
    fileSaveRequests: [
      {
        eventType: "workspace.file.save",
        id: "file-save-1",
        requester: "Maddie",
        requesterUserId: "github:maddie",
        path: "README.md",
        previousContent: "# Old\n",
        nextContent: "# New\n",
        requestedAt: "2026-07-08T12:00:00.000Z",
        status: "pending"
      },
      {
        eventType: "workspace.file.save",
        id: "file-save-invalid",
        requester: "Maddie",
        requesterUserId: "github:maddie",
        path: "README.md",
        previousContent: "# Old\n",
        nextContent: "# New\n",
        requestedAt: "2026-07-08T12:00:00.000Z",
        status: "maybe"
      }
    ],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: []
  });

  assert.deepEqual(
    payload.fileSaveRequests.map((request) => request.id),
    ["file-save-1"]
  );
  assert.equal(payload.fileSaveRequests[0]?.status, "pending");
});

test("encrypted history keeps file save requests local and encrypted", async () => {
  const roomId = "room-file-save-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    fileSaveRequests: [
      {
        eventType: "workspace.file.save",
        id: "file-save-1",
        requester: "Maddie",
        requesterUserId: "github:maddie",
        path: "README.md",
        previousContent: "old private content",
        nextContent: "new private content",
        requestedAt: "2026-07-08T12:00:00.000Z",
        status: "pending"
      }
    ],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: []
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /new private content/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("encrypted history keeps Git workflow and Actions events local and encrypted", async () => {
  const roomId = "room-git-events-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [
      {
        eventType: "git.workflow",
        status: "pr_opened",
        branch: "codex/add-history",
        push: true,
        message: "Opened draft PR #42: https://github.com/maddiedreese/multAIplayer/pull/42",
        runner: "Maddie",
        runnerUserId: "github:maddie",
        createdAt: "2026-07-05T00:00:00.000Z",
        results: [
          {
            command: "git push origin codex/add-history",
            cwd: "/Users/maddie/dev/multAIplayer",
            status: 0,
            stdout: "pushed branch",
            stderr: ""
          }
        ],
        pullRequest: {
          number: 42,
          url: "https://github.com/maddiedreese/multAIplayer/pull/42"
        }
      }
    ],
    githubActionsEvents: [
      {
        eventType: "github.actions",
        owner: "maddiedreese",
        repo: "multAIplayer",
        branch: "codex/add-history",
        summary: {
          label: "passing",
          detail: "All loaded workflow runs are passing.",
          tone: "green"
        },
        message: "Loaded 1 workflow run for codex/add-history.",
        checkedBy: "Maddie",
        checkedByUserId: "github:maddie",
        checkedAt: "2026-07-05T00:01:00.000Z",
        runs: [
          {
            id: 28724623234,
            name: "CI",
            displayTitle: "Add encrypted Git history",
            runNumber: 42,
            workflowId: 1,
            status: "completed",
            conclusion: "success",
            branch: "codex/add-history",
            headSha: "abc123",
            event: "push",
            url: "https://github.com/maddiedreese/multAIplayer/actions/runs/28724623234",
            createdAt: "2026-07-05T00:00:30.000Z",
            updatedAt: "2026-07-05T00:01:00.000Z"
          }
        ]
      }
    ],
    terminalSnapshots: [],
    hostHandoffs: []
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /codex\/add-history/);
  assert.doesNotMatch(stored, /Opened draft PR/);
  assert.doesNotMatch(stored, /28724623234/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("encrypted history keeps terminal snapshots local and encrypted", async () => {
  const roomId = "room-terminal-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    terminalSnapshots: [
      {
        id: "room-terminal-history:dev-server",
        roomId,
        name: "dev-server",
        cwd: "/Users/maddie/dev/multAIplayer",
        command: "npm run dev:desktop",
        running: false,
        exitStatus: null,
        startedAt: "2026-07-05T00:02:00.000Z",
        lines: [
          { stream: "system", text: "$ npm run dev:desktop" },
          { stream: "stdout", text: "Local relay ready on http://127.0.0.1:4321" }
        ]
      }
    ],
    hostHandoffs: []
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /npm run dev:desktop/);
  assert.doesNotMatch(stored, /Local relay ready/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("replaceRoomSecret clears stale encrypted history", async () => {
  const roomId = "room-rotate-key";
  await saveEncryptedHistory(roomId, { messages: [{ body: "before rotation" }] });
  assert.ok(localStorage.getItem(`multaiplayer:history:${roomId}`));

  const oldSecret = await loadRoomSecret(roomId);
  assert.ok(oldSecret);
  await replaceRoomSecret(roomId, {
    algorithm: "AES-GCM-256",
    rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  });

  const nextSecret = await loadRoomSecret(roomId);
  assert.notEqual(nextSecret?.rawKey, oldSecret.rawKey);
  assert.equal(localStorage.getItem(`multaiplayer:history:${roomId}`), null);
});

test("legacy room secrets migrate into a memory-only epoch-one keyring", async () => {
  const roomId = "room-legacy-keyring";
  const legacySecret = { algorithm: "AES-GCM-256" as const, rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  localStorage.setItem(`multaiplayer:room-secret:${roomId}`, JSON.stringify(legacySecret));

  assert.deepEqual(await loadRoomSecret(roomId), legacySecret);
  assert.deepEqual(await loadRoomKeyring(roomId), {
    version: 2,
    currentEpoch: 1,
    keys: { "1": legacySecret }
  });
  assert.equal(localStorage.getItem(`multaiplayer:room-secret:${roomId}`), null);
});

test("room keyrings retain specific prior epochs while advancing current access", async () => {
  const roomId = "room-epoch-keyring";
  const first = { algorithm: "AES-GCM-256" as const, rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  const second = { algorithm: "AES-GCM-256" as const, rawKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" };
  await importRoomSecret(roomId, first);
  await saveEncryptedHistory(roomId, { retained: "epoch-one-history" });
  await installRoomSecretEpoch(roomId, 2, second);

  assert.deepEqual(await loadRoomSecret(roomId), second);
  assert.deepEqual(await loadRoomSecret(roomId, 1), first);
  assert.deepEqual(await loadRoomSecret(roomId, 2), second);
  assert.deepEqual(await loadEncryptedHistory(roomId), { retained: "epoch-one-history" });
  await clearEncryptedHistory(roomId);
  assert.equal(await loadRoomSecret(roomId, 1), null);
  await assert.rejects(() => installRoomSecretEpoch(roomId, 4, first), /does not immediately follow/);
});

test("pending rotations survive restart-style reload and clear only after completion", async () => {
  const roomId = "room-pending-rotation";
  const first = { algorithm: "AES-GCM-256" as const, rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  const second = { algorithm: "AES-GCM-256" as const, rawKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" };
  await importRoomSecret(roomId, first);
  const pending = {
    envelope: {
      id: "envelope-pending",
      teamId: "team-pending",
      roomId,
      senderDeviceId: "device-host",
      senderUserId: "github:host",
      createdAt: "2026-07-10T12:00:00.000Z",
      kind: "room.key" as const,
      keyEpoch: 1,
      payload: { version: 2 as const, algorithm: "AES-GCM-256" as const, nonce: "nonce", ciphertext: "ciphertext" }
    },
    payload: {
      eventType: "room.key.rotated" as const,
      id: "rotation-pending",
      rotatedBy: "Host",
      rotatedByUserId: "github:host",
      rotatedAt: "2026-07-10T12:00:00.000Z",
      previousEpoch: 1,
      newEpoch: 2,
      recipients: [
        {
          userId: "github:host",
          deviceId: "device-host",
          publicKeyFingerprint: `sha256:${Array(16).fill("0000").join(":")}`,
          wrappedRoomSecret: {
            version: 2 as const,
            algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
            ephemeralPublicKeyJwk: { kty: "EC" as const, crv: "P-256" as const, x: "eA", y: "eQ" },
            nonce: "nonce",
            ciphertext: "ciphertext",
            senderPublicKeyJwk: { kty: "EC" as const, crv: "P-256" as const, x: "eA", y: "eQ" },
            signature: "signature"
          }
        }
      ],
      note: "test"
    },
    newSecret: second,
    installed: false
  };
  await savePendingRoomRotation(roomId, pending);
  assert.deepEqual(await loadPendingRoomRotation(roomId), pending);
  await installRoomSecretEpoch(roomId, 2, second);
  await assert.doesNotReject(() => installRoomSecretEpoch(roomId, 2, second));
  await assert.rejects(() => installRoomSecretEpoch(roomId, 2, first), /different key material/);
  await savePendingRoomRotation(roomId, { ...pending, installed: true });
  assert.equal((await loadPendingRoomRotation(roomId))?.installed, true);
  await clearPendingRoomRotation(roomId, pending.payload.id);
  assert.equal(await loadPendingRoomRotation(roomId), null);
});

test("disabled history clears stored ciphertext and prevents new saves", async () => {
  const roomId = "room-history-off";

  await saveEncryptedHistory(roomId, { messages: [{ body: "keep me encrypted" }] });
  assert.ok(localStorage.getItem(`multaiplayer:history:${roomId}`));

  const savedSettings = saveHistorySettings(roomId, { enabled: false, retentionDays: 30 });
  assert.deepEqual(savedSettings, { enabled: false, retentionDays: 30 });
  assert.equal(localStorage.getItem(`multaiplayer:history:${roomId}`), null);

  await saveEncryptedHistory(roomId, { messages: [{ body: "do not persist" }] });
  assert.equal(localStorage.getItem(`multaiplayer:history:${roomId}`), null);
  assert.equal(await loadEncryptedHistory(roomId), null);
});

test("expired encrypted history is removed on load", async () => {
  const roomId = "room-expired-history";
  saveHistorySettings(roomId, { enabled: true, retentionDays: 1 });
  await saveEncryptedHistory(roomId, { messages: [{ body: "old encrypted value" }] });

  const key = `multaiplayer:history:${roomId}`;
  const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as { savedAt: string };
  localStorage.setItem(
    key,
    JSON.stringify({
      ...stored,
      savedAt: "2001-01-01T00:00:00.000Z"
    })
  );

  assert.equal(await loadEncryptedHistory(roomId), null);
  assert.equal(localStorage.getItem(key), null);
});

test("malformed encrypted history records are removed on load", async () => {
  const roomId = "room-malformed-history";
  const key = `multaiplayer:history:${roomId}`;
  localStorage.setItem(
    key,
    JSON.stringify({
      savedAt: "not-a-date",
      ciphertext: {
        algorithm: "AES-GCM-256",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA=="
      }
    })
  );

  assert.equal(await loadEncryptedHistory(roomId), null);
  assert.equal(localStorage.getItem(key), null);
});

test("tampered encrypted history is removed without exposing plaintext", async () => {
  const roomId = "room-tampered-history";
  const key = `multaiplayer:history:${roomId}`;
  await saveEncryptedHistory(roomId, { messages: [{ body: "still private" }] });
  const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as {
    savedAt: string;
    ciphertext: { algorithm: string; nonce: string; ciphertext: string };
  };
  localStorage.setItem(
    key,
    JSON.stringify({
      ...stored,
      ciphertext: {
        ...stored.ciphertext,
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA=="
      }
    })
  );

  assert.equal(await loadEncryptedHistory(roomId), null);
  assert.equal(localStorage.getItem(key), null);
  assert.doesNotMatch(localStorage.dump(), /still private/);
});

test("history retention settings are sanitized to the supported range", () => {
  assert.deepEqual(saveHistorySettings("room-low", { enabled: true, retentionDays: -10 }), {
    enabled: true,
    retentionDays: 1
  });
  assert.deepEqual(saveHistorySettings("room-high", { enabled: true, retentionDays: 1000 }), {
    enabled: true,
    retentionDays: 365
  });
  assert.deepEqual(loadHistorySettings("missing-room"), {
    enabled: true,
    retentionDays: 30
  });
});

test("encrypted history keeps local room goals encrypted", async () => {
  const roomId = "room-goal-history";
  const payload = {
    version: 3,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: [],
    roomGoal: {
      id: "goal-secret",
      text: "Coordinate private launch checklist",
      status: "active",
      startedAt: "2026-07-08T18:00:00.000Z",
      updatedAt: "2026-07-08T18:01:00.000Z",
      elapsedMs: 60000
    }
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /Coordinate private launch checklist/);
  assert.doesNotMatch(localStorage.dump(), /goal-secret/);

  const restored = await loadEncryptedHistory<typeof payload>(roomId);
  const normalized = normalizeLocalRoomHistory(restored!);
  assert.equal(normalized.roomGoal?.text, "Coordinate private launch checklist");
  assert.equal(normalized.roomGoal?.status, "active");
});

test("clearEncryptedHistory removes only the selected room payload", async () => {
  await saveEncryptedHistory("room-a", { messages: [{ body: "alpha" }] });
  await saveEncryptedHistory("room-b", { messages: [{ body: "beta" }] });

  await clearEncryptedHistory("room-a");

  assert.equal(localStorage.getItem("multaiplayer:history:room-a"), null);
  assert.ok(localStorage.getItem("multaiplayer:history:room-b"));
  assert.deepEqual(await loadEncryptedHistory("room-b"), { messages: [{ body: "beta" }] });
});

test("loadEncryptedHistory does not create a room secret when no history exists", async () => {
  assert.equal(await loadEncryptedHistory("room-no-history"), null);
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-no-history"), null);
});

test("invalid fallback room secrets are removed instead of migrated", async () => {
  const roomId = "room-invalid-fallback-secret";
  const key = `multaiplayer:room-secret:${roomId}`;
  localStorage.setItem(
    key,
    JSON.stringify({
      algorithm: "AES-GCM-256",
      rawKey: "not-a-256-bit-key"
    })
  );

  assert.equal(await loadRoomSecret(roomId), null);
  assert.equal(localStorage.getItem(key), null);
});

test("room secret imports reject invalid key material", async () => {
  await assert.rejects(
    () =>
      importRoomSecret("room-invalid-import", {
        algorithm: "AES-GCM-256",
        rawKey: "not-a-256-bit-key"
      }),
    /Room key must be 256 bits/
  );
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-invalid-import"), null);
});

test("forgetRoomLocalData removes history, settings, and the local fallback room secret", async () => {
  await saveEncryptedHistory("room-a", { messages: [{ body: "alpha" }] });
  await importRoomSecret("room-a", {
    algorithm: "AES-GCM-256",
    rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  });
  saveHistorySettings("room-a", { enabled: true, retentionDays: 12 });

  await saveEncryptedHistory("room-b", { messages: [{ body: "beta" }] });

  await forgetRoomLocalData("room-a");

  assert.equal(localStorage.getItem("multaiplayer:history:room-a"), null);
  assert.equal(localStorage.getItem("multaiplayer:history-settings:room-a"), null);
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-a"), null);
  assert.equal(await loadRoomSecret("room-a"), null);
  assert.ok(localStorage.getItem("multaiplayer:history:room-b"));
});

test("room visibility warning acknowledgement is scoped and resettable per room", () => {
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), false);
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-b"), false);

  acknowledgeRoomVisibilityWarning("room-a");

  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), true);
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-b"), false);
  assert.equal(localStorage.getItem(roomVisibilityWarningKey("room-a")), "acknowledged");

  clearRoomVisibilityWarningAcknowledgement("room-a");

  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), false);
  assert.equal(hasAcknowledgedRoomVisibilityWarning(""), true);
});

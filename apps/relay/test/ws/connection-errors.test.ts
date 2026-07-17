import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRelayStore, RelayStoreByteCapacityError, RelayStoreCapacityError } from "../../src/state.js";
import { registerRelayWebSocketConnection, relayWebSocketError } from "../../src/ws/connection.js";
import { dispatchRelayClientMessage } from "../../src/ws/connection-dispatch.js";
import type { RelayWebSocketConnectionOptions } from "../../src/ws/connection-types.js";
import { deleteAccountOwnedRelayDataAtomically } from "../../src/auth/account-deletion.js";
import { isLiveAccountSession } from "../../src/auth/account-mutation-transaction.js";

test("WebSocket capacity failures use a stable code without exposing internal ceiling prose", () => {
  for (const error of [
    new RelayStoreCapacityError(10, "team"),
    new RelayStoreByteCapacityError("mls_backlog", 10, "room", "team:room")
  ]) {
    const response = relayWebSocketError(error, "message-one");
    assert.equal(response.code, "capacity_exceeded");
    assert.equal(response.message, "Relay durable capacity is exhausted.");
    assert.equal(response.messageId, "message-one");
    assert.equal(JSON.stringify(response).includes("10"), false);
  }
});

test("presence publication stops when the joined room becomes inactive", async () => {
  const sent: unknown[] = [];
  const roster = new Map([["existing-device", { displayName: "Existing" }]]);
  let published = false;
  const socket = { OPEN: 1, readyState: 1 };
  const session = {
    socket,
    rateClientId: "test",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const options = {
    state: { sessions: new Map([[socket, session]]) },
    transport: { send: (_socket: unknown, message: unknown) => sent.push(message) },
    authentication: { isLiveClientSession: () => true },
    rooms: {
      isKnownRoom: () => false,
      publishPresence: () => {
        published = true;
        roster.set("device-member", { displayName: "Member" });
      }
    }
  } as unknown as RelayWebSocketConnectionOptions;

  await dispatchRelayClientMessage(options, session as never, {
    type: "presence",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    displayName: "Member"
  });

  assert.equal(published, false);
  assert.deepEqual(Array.from(roster.keys()), ["existing-device"]);
  assert.deepEqual(sent, [
    { type: "error", message: "Join the room before publishing presence with this user and device." }
  ]);
});

test("a queued MLS publish cannot commit after account deletion wins the account turn", async () => {
  const store = createRelayStore();
  const userId = "github:queued";
  const deviceId = "device-queued";
  const authSession = {
    sessionIdHash: "session-queued",
    user: { id: userId, login: "queued" },
    expiresAt: Date.now() + 60_000
  };
  store.authSessions.set(authSession.sessionIdHash, authSession);
  store.deviceSessions.set("device-token", { token: "device-token", userId, deviceId, expiresAt: Date.now() + 60_000 });
  const closed: Array<[number, string]> = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    close(code: number, reason: string) {
      closed.push([code, reason]);
      this.readyState = 2;
    }
  };
  const session = {
    socket,
    authSession,
    rateClientId: "test",
    teamId: "team-core",
    roomId: "room-desktop",
    userId,
    deviceId,
    deviceSessionToken: "device-token",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const sent: unknown[] = [];
  let published = false;
  const options = {
    state: { store, sessions: new Map([[socket, session]]) },
    transport: { send: (_socket: unknown, message: unknown) => sent.push(message) },
    authentication: {
      isLiveClientSession: () => store.authSessions.get(authSession.sessionIdHash) === authSession
    },
    rooms: {
      hasDeviceSession: (token: string) => store.deviceSessions.has(token),
      canAccessRoom: () => true,
      canPublishMlsMessage: () => true,
      publishMlsMessage: async () => {
        published = true;
      }
    },
    limits: {
      mlsMessageMaxBytes: 1_000_000,
      maxDeviceIdChars: 160,
      maxEnvelopeIdChars: 160,
      maxMlsMessageChars: 1_400_000,
      maxUserIdChars: 160
    },
    validation: {
      isJsonStringifiableWithin: () => true,
      normalizeMetadataText: (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)
    }
  } as unknown as RelayWebSocketConnectionOptions;
  const persistEntered = deferred<void>();
  const releasePersistence = deferred<void>();
  const deleting = deleteAccountOwnedRelayDataAtomically(store, userId, async () => {
    persistEntered.resolve();
    await releasePersistence.promise;
  });
  await persistEntered.promise;
  const publishing = dispatchRelayClientMessage(options, session as never, {
    type: "publish",
    message: {
      id: "message-queued",
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: userId,
      senderDeviceId: deviceId,
      messageType: "application",
      epochHint: 0,
      mlsMessage: "AA==",
      createdAt: new Date().toISOString()
    }
  });
  releasePersistence.resolve();
  await deleting;
  await publishing;
  assert.equal(published, false);
  assert.equal(JSON.stringify(sent).includes("not_joined"), true);
  assert.deepEqual(closed, [[1008, "Authentication session expired"]]);
});

test("a queued host handoff cannot assign authority to an account after its deletion wins the target turn", async () => {
  const store = createRelayStore();
  const senderUserId = "github:current-host";
  const targetUserId = "github:deleting-host";
  const targetDeviceId = "device-deleting-host";
  const authSession = {
    sessionIdHash: "session-current-host",
    user: { id: senderUserId, login: "current-host" },
    expiresAt: Date.now() + 60_000
  };
  store.authSessions.set(authSession.sessionIdHash, authSession);
  store.deviceSessions.set("current-host-token", {
    token: "current-host-token",
    userId: senderUserId,
    deviceId: "device-current-host",
    expiresAt: Date.now() + 60_000
  });
  store.setTeam({ id: "team-core", name: "Core", members: 2 });
  store.setTeamMembers(
    "team-core",
    new Map([
      [senderUserId, { teamId: "team-core", userId: senderUserId, role: "owner", joinedAt: new Date().toISOString() }],
      [targetUserId, { teamId: "team-core", userId: targetUserId, role: "member", joinedAt: new Date().toISOString() }]
    ])
  );
  store.setDevice({
    userId: targetUserId,
    deviceId: targetDeviceId,
    displayName: "Deleting host",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });
  const socket = { OPEN: 1, readyState: 1 };
  const session = {
    socket,
    authSession,
    rateClientId: "test",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: senderUserId,
    deviceId: "device-current-host",
    deviceSessionToken: "current-host-token",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  let published = false;
  const sent: unknown[] = [];
  const options = {
    state: { store, sessions: new Map([[socket, session]]) },
    transport: { send: (_socket: unknown, message: unknown) => sent.push(message) },
    authentication: { isLiveClientSession: () => true },
    rooms: {
      hasDeviceSession: () => true,
      canAccessRoom: () => true,
      canPublishMlsMessage: () => true,
      publishMlsMessage: async () => {
        published = true;
      }
    },
    limits: {
      mlsMessageMaxBytes: 1_000_000,
      maxDeviceIdChars: 160,
      maxEnvelopeIdChars: 160,
      maxMlsMessageChars: 1_400_000,
      maxUserIdChars: 160
    },
    validation: {
      isJsonStringifiableWithin: () => true,
      normalizeMetadataText: (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)
    }
  } as unknown as RelayWebSocketConnectionOptions;
  const deletionEnteredPersistence = deferred<void>();
  const releaseDeletion = deferred<void>();
  const deleting = deleteAccountOwnedRelayDataAtomically(store, targetUserId, async () => {
    deletionEnteredPersistence.resolve();
    await releaseDeletion.promise;
  });
  await deletionEnteredPersistence.promise;
  const publishing = dispatchRelayClientMessage(options, session as never, {
    type: "publish",
    message: {
      id: "handoff-after-deletion",
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId,
      senderDeviceId: "device-current-host",
      messageType: "commit",
      commitEffect: "host_handoff",
      nextHostUserId: targetUserId,
      nextHostDeviceId: targetDeviceId,
      epochHint: 0,
      mlsMessage: "AA==",
      createdAt: new Date().toISOString()
    }
  });
  releaseDeletion.resolve();
  await deleting;
  await publishing;
  assert.equal(published, false);
  assert.equal(store.getTeamMember("team-core", targetUserId), undefined);
  assert.equal(store.getDevice(targetUserId, targetDeviceId), undefined);
  assert.equal(JSON.stringify(sent).includes("not_joined"), true);
});

test("a presence message queued before close cannot run after its socket is unregistered", async () => {
  let published = false;
  const socket = { OPEN: 1, readyState: 2 };
  const session = {
    socket,
    rateClientId: "test",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const options = {
    state: { sessions: new Map() },
    rooms: { publishPresence: () => (published = true) }
  } as unknown as RelayWebSocketConnectionOptions;
  await dispatchRelayClientMessage(options, session as never, {
    type: "presence",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    displayName: "Member"
  });
  assert.equal(published, false);
});

test("queued actions close and unregister logged-out or expired authentication sessions", async (t) => {
  for (const staleSessionKind of ["expired", "logged_out"] as const) {
    await t.test(staleSessionKind, async () => {
      const store = createRelayStore();
      const authSession = {
        sessionIdHash: `session-${staleSessionKind}`,
        user: { id: "github:member", login: "member" },
        expiresAt: Date.now() + 60_000
      };
      store.authSessions.set(authSession.sessionIdHash, authSession);
      const sent: unknown[] = [];
      const closed: Array<[number, string]> = [];
      const cleanup: string[] = [];
      let joined = false;
      let publishedPresence = false;
      const sessions = new Map();
      const socket = Object.assign(new EventEmitter(), {
        OPEN: 1,
        readyState: 1,
        close(this: EventEmitter & { readyState: number }, code: number, reason: string) {
          closed.push([code, reason]);
          this.readyState = 2;
          this.emit("close");
        }
      });
      let acceptConnection: ((socket: unknown, request: unknown) => void) | undefined;
      const options = {
        state: { store, sessions, roomPresence: new Map() },
        transport: {
          wss: {
            on: (event: string, listener: (socket: unknown, request: unknown) => void) => {
              if (event === "connection") acceptConnection = listener;
            }
          },
          send: (_socket: unknown, message: unknown) => sent.push(message)
        },
        authentication: {
          getAuthSessionFromRequest: () => authSession,
          isLiveClientSession: () => isLiveAccountSession(store, authSession),
          clientIdentityFromIncomingMessage: () => "test"
        },
        rateLimiting: {
          consume: () => ({ allowed: true }),
          connectionCaps: { perUser: 10, perDevice: 10 }
        },
        metrics: {},
        rooms: {
          joinRoom: () => (joined = true),
          publishPresence: () => (publishedPresence = true),
          leaveRoom: () => cleanup.push("room"),
          leaveTeams: () => cleanup.push("teams"),
          leaveWorkspace: () => cleanup.push("workspace")
        },
        validation: {}
      } as unknown as RelayWebSocketConnectionOptions;
      registerRelayWebSocketConnection(options);
      assert.ok(acceptConnection);
      acceptConnection(socket, {});
      const session = sessions.get(socket);
      assert.ok(session);

      if (staleSessionKind === "expired") authSession.expiresAt = Date.now() - 1;
      else store.authSessions.delete(authSession.sessionIdHash);

      await dispatchRelayClientMessage(options, session as never, {
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:member",
        deviceId: "device-member",
        displayName: "Member"
      });
      await dispatchRelayClientMessage(options, session as never, {
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:member",
        deviceId: "device-member",
        deviceSessionToken: "device-token"
      });

      assert.equal(publishedPresence, false, "a stale session cannot publish queued presence");
      assert.equal(joined, false, "a later queued action cannot run after the stale socket closes");
      assert.deepEqual(sent, [{ type: "error", message: "Authentication session expired.", code: "not_joined" }]);
      assert.deepEqual(closed, [[1008, "Authentication session expired"]]);
      assert.deepEqual(cleanup, ["room", "teams", "workspace"]);
      assert.equal(sessions.has(socket), false, "close cleanup unregisters the stale socket");
    });
  }
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

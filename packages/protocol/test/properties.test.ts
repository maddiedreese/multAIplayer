import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { MlsRelayMessage, RelayClientMessage, RelayServerMessage, pinnedMlsCiphersuite } from "../src/index.js";

const mlsMessage = {
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  createdAt: "2026-07-15T00:00:00.000Z",
  messageType: "application" as const,
  epochHint: 0,
  mlsMessage: "AA=="
};

const team = { id: "team-1", name: "Team", members: 1 };
const room = {
  id: "room-1",
  teamId: "team-1",
  acceptedMlsEpoch: 0,
  name: "Room",
  host: "Host",
  hostUserId: "user-1",
  activeHostDeviceId: "device-1",
  hostStatus: "active" as const,
  approvalPolicy: "ask_every_turn" as const,
  mode: { chat: true, code: true, workspace: true, browser: false },
  browserProfilePersistent: false,
  unread: 0
};

const clientCases = [
  { type: "join", teamId: "team-1", roomId: "room-1", userId: "user-1", deviceId: "device-1" },
  { type: "subscribe.team", teamId: "team-1", userId: "user-1", deviceId: "device-1" },
  { type: "subscribe.workspace", userId: "user-1", deviceId: "device-1" },
  { type: "publish", message: mlsMessage },
  {
    type: "presence",
    teamId: "team-1",
    roomId: "room-1",
    userId: "user-1",
    deviceId: "device-1",
    displayName: "User"
  }
] as const;

const serverCases = [
  { type: "joined", teamId: "team-1", roomId: "room-1" },
  { type: "team.subscribed", teamId: "team-1" },
  { type: "workspace.subscribed" },
  { type: "invite.requested", inviteId: "invite-1", requestId: "request-1" },
  { type: "published", messageId: "message-1" },
  { type: "mls.message", message: mlsMessage },
  {
    type: "presence",
    teamId: "team-1",
    roomId: "room-1",
    userId: "user-1",
    deviceId: "device-1",
    displayName: "User",
    status: "online"
  },
  { type: "room.updated", room },
  { type: "team.updated", team },
  { type: "error", message: "stale", code: "stale_epoch", messageId: "message-1" }
] as const;

test("every relay client and server discriminant round-trips through JSON and its authoritative schema", () => {
  for (const value of clientCases) {
    assert.deepEqual(RelayClientMessage.parse(JSON.parse(JSON.stringify(value))), value);
  }
  for (const value of serverCases) {
    assert.deepEqual(RelayServerMessage.parse(JSON.parse(JSON.stringify(value))), value);
  }
  assert.deepEqual(MlsRelayMessage.parse(JSON.parse(JSON.stringify(mlsMessage))), mlsMessage);
});

test("relay message schemas recursively strip or reject arbitrary fields outside their allowlists", () => {
  const cases = [
    ...clientCases.map((value) => ({ schema: RelayClientMessage, value })),
    ...serverCases.map((value) => ({ schema: RelayServerMessage, value }))
  ];
  fc.assert(
    fc.property(
      fc.constantFrom(...cases),
      fc.stringMatching(/^unknown_[a-z0-9_]{1,20}$/),
      fc.jsonValue({ maxDepth: 4 }),
      ({ schema, value }, key, extra) => {
        const contaminated = contaminateEveryObject(value, key, extra);
        const parsed = schema.safeParse(contaminated);
        if (!parsed.success) return;
        assert.deepEqual(parsed.data, schema.parse(value));
        assertNoKey(parsed.data, key);
      }
    ),
    { numRuns: 1_000 }
  );
});

test("suite is pinned", () => assert.equal(pinnedMlsCiphersuite, 2));

function contaminateEveryObject(value: unknown, key: string, extra: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => contaminateEveryObject(item, key, extra));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries([
    ...Object.entries(value).map(([childKey, child]) => [childKey, contaminateEveryObject(child, key, extra)]),
    [key, extra]
  ]);
}

function assertNoKey(value: unknown, forbidden: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoKey(item, forbidden);
    return;
  }
  if (!value || typeof value !== "object") return;
  assert.equal(Object.hasOwn(value, forbidden), false);
  for (const child of Object.values(value)) assertNoKey(child, forbidden);
}

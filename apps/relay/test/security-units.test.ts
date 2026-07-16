import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelayLimits,
  isApprovalPolicy,
  isJsonStringifiableWithin,
  isMlsMessageWithinLimits,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeCodexCatalogSelectionPolicy,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexReasoningEffortOrDefault,
  normalizeCodexSpeed,
  normalizeCodexSpeedOrDefault,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath,
  normalizeTeamRole,
  parseIntegerValue,
  pruneMlsBacklog
} from "../src/limits.js";
import { createRelayAuthz } from "../src/authz.js";
import { createRelayStore } from "../src/state.js";
import { canPublishMlsMessage } from "../src/relay-domain.js";
const message = {
  id: "m",
  teamId: "team",
  roomId: "room",
  senderUserId: "user",
  senderDeviceId: "device-1",
  createdAt: new Date().toISOString(),
  messageType: "application" as const,
  epochHint: 0,
  mlsMessage: "AA=="
};
test("MLS publishers cannot spoof the sender identity used for exact-local replay classification", () => {
  const session = {
    teamId: "team",
    roomId: "room",
    userId: "user",
    deviceId: "device-1"
  } as Parameters<typeof canPublishMlsMessage>[0];
  assert.equal(canPublishMlsMessage(session, message), true);
  assert.equal(canPublishMlsMessage(session, { ...message, senderUserId: "other-user" }), false);
  assert.equal(canPublishMlsMessage(session, { ...message, senderDeviceId: "device-2" }), false);
});
test("MLS routing boundaries reject control text and oversize blobs", () => {
  assert.equal(normalizeMetadataText("bad\0id", 32), null);
  assert.equal(
    isMlsMessageWithinLimits(message, {
      mlsMessageMaxBytes: 1024,
      maxMlsMessageChars: 32,
      maxEnvelopeIdChars: 32,
      maxDeviceIdChars: 32,
      maxPublicKeyJwkChars: 4096,
      maxUserIdChars: 128
    }),
    true
  );
  assert.equal(
    isMlsMessageWithinLimits(
      { ...message, mlsMessage: "x".repeat(33) },
      {
        mlsMessageMaxBytes: 1024,
        maxMlsMessageChars: 32,
        maxEnvelopeIdChars: 32,
        maxDeviceIdChars: 32,
        maxPublicKeyJwkChars: 4096,
        maxUserIdChars: 128
      }
    ),
    false
  );
});
test("MLS backlog retention is bounded", () =>
  assert.equal(
    pruneMlsBacklog([message], {
      mlsMessageMaxBytes: 1024,
      maxMlsMessageChars: 32,
      maxEnvelopeIdChars: 32,
      maxDeviceIdChars: 32,
      maxPublicKeyJwkChars: 4096,
      maxUserIdChars: 128,
      mlsBacklogLimit: 1,
      mlsBacklogRetentionDays: 30
    }).length,
    1
  ));
test("relay authorization remains membership scoped", () => {
  const store = createRelayStore();
  store.setTeam({ id: "team", name: "Team", members: 1 });
  store.setTeamMembers(
    "team",
    new Map([["user", { teamId: "team", userId: "user", role: "member", joinedAt: new Date().toISOString() }]])
  );
  store.setRoom({ id: "room", teamId: "team" } as never);
  const authz = createRelayAuthz(store);
  assert.equal(authz.canAccessRoom("team", "room", "user"), true);
  assert.equal(authz.canAccessRoom("team", "missing", "user"), false);
  assert.equal(authz.canAccessRoom("other", "room", "user"), false);
  assert.equal(authz.canAccessRoom("team", "room", "outsider"), false);
  assert.deepEqual(authz.teamIdsForUser("user"), new Set(["team"]));
  assert.equal(authz.isTeamMember("team", "missing"), false);
});
test("authorization exhaustively covers roles and transfers", () => {
  const authz = createRelayAuthz(createRelayStore()),
    roles = ["owner", "admin", "member"] as const;
  for (const requester of [undefined, ...roles])
    for (const target of roles) {
      assert.equal(
        authz.canRemoveTeamMember(requester, target),
        target !== "owner" && (requester === "owner" || (requester === "admin" && target === "member"))
      );
      for (const next of roles)
        assert.equal(
          authz.canSetTeamMemberRole(requester, target, next),
          target !== "owner" &&
            next !== "owner" &&
            (requester === "owner" || (requester === "admin" && target === "member" && next === "member"))
        );
    }
  assert.deepEqual(
    roles.map((x) => authz.teamRoleRank(x)),
    [0, 1, 2]
  );
  const records = new Map(
    roles.map((role) => [role, { teamId: "team", userId: role, role, joinedAt: new Date().toISOString() }])
  );
  records.set("observer", {
    teamId: "team",
    userId: "observer",
    role: "member",
    joinedAt: new Date().toISOString()
  });
  const moved = authz.transferTeamOwnership(records, "member");
  assert.equal(moved.get("member")?.role, "owner");
  assert.equal(moved.get("owner")?.role, "admin");
  assert.equal(moved.get("admin")?.role, "admin");
  assert.equal(moved.get("observer")?.role, "member");
});
test("scalar and policy normalizers fail closed", () => {
  const values = {
    maxDisplayNameChars: 100,
    maxDeviceIdChars: 128,
    maxEnvelopeIdChars: 128,
    maxPublicKeyFingerprintChars: 255,
    maxPublicKeyJwkChars: 2048,
    maxRoomProjectPathChars: 4096,
    maxUserIdChars: 128
  };
  assert.equal(Object.isFrozen(createRelayLimits(16384, values)), true);
  assert.equal(normalizeMetadataText(" ok ", 10), "ok");
  assert.equal(normalizeMetadataText("\0", 10), null);
  assert.equal(normalizeMetadataText("long", 2), null);
  assert.equal(normalizeRelayId("id_1", 10), "id_1");
  for (const x of [" bad", "bad id", "", 3]) assert.equal(normalizeRelayId(x, 10), null);
  assert.equal(normalizeOptionalMetadataText(undefined, 10), "");
  assert.equal(normalizeOptionalMetadataText(" ok ", 10), "ok");
  assert.equal(isJsonStringifiableWithin({ ok: true }, 20), true);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(isJsonStringifiableWithin(circular, 20), false);
  assert.equal(isJsonStringifiableWithin({ long: "x" }, 2), false);
  assert.equal(parseIntegerValue("4.6", 1, 2, 4), 4);
  assert.equal(parseIntegerValue({}, 3, 1, 5), 3);
  assert.equal(parseIntegerValue(-2, 3, 1, 5), 1);
  assert.equal(maxCiphertextCharactersForBlob(0), 1430);
  assert.equal(isApprovalPolicy("ask_every_turn"), true);
  assert.equal(isApprovalPolicy("bad"), false);
  assert.equal(isRoomMode({ chat: true, code: false, workspace: true, browser: false }), true);
  assert.equal(isRoomMode(null), false);
  assert.equal(isRoomMode({ chat: true }), false);
  assert.equal(normalizeRoomProjectPath(" /repo ", 20), "/repo");
  assert.equal(normalizeRoomProjectPath("\n", 20), null);
  assert.equal(normalizeCodexModel("gpt-custom/1", 30), "gpt-custom/1");
  assert.equal(normalizeCodexModel("bad model", 30), null);
  assert.equal(normalizeCodexReasoningEffort("medium"), "medium");
  assert.equal(normalizeCodexReasoningEffort("bad"), null);
  assert.equal(normalizeCodexSpeed("standard"), "standard");
  assert.equal(normalizeCodexSpeed("bad"), null);
  assert.equal(normalizeCodexCatalogSelectionPolicy("pinned"), "pinned");
  assert.equal(normalizeCodexCatalogSelectionPolicy("bad"), null);
  assert.equal(normalizeCodexReasoningEffortOrDefault("bad"), "medium");
  assert.equal(normalizeCodexSpeedOrDefault("bad"), "standard");
  assert.equal(normalizeTeamRole("admin"), "admin");
  assert.equal(normalizeTeamRole("bad"), "member");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { RelayEnvelope, TeamMemberRecord } from "@multaiplayer/protocol";
import { createRelayAuthz } from "../src/authz.js";
import {
  isAllowedEnvelopePayload,
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isJsonStringifiableWithin,
  isRelayEnvelopeWithinLimits,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
  normalizeCodexCatalogSelectionPolicy,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexReasoningEffortOrDefault,
  normalizeCodexSpeed,
  normalizeCodexSpeedOrDefault,
  normalizeDevicePublicKeyJwk,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath,
  normalizeTeamRole,
  parseIntegerValue,
  pruneEncryptedBacklog
} from "../src/limits.js";
import { InMemoryRelayStore } from "../src/state.js";

const joinedAt = "2026-07-11T00:00:00.000Z";

function member(userId: string, role: TeamMemberRecord["role"]): TeamMemberRecord {
  return { userId, role, joinedAt };
}

function envelope(overrides: Partial<RelayEnvelope> = {}): RelayEnvelope {
  return {
    id: "event_1",
    teamId: "team_1",
    roomId: "room_1",
    senderDeviceId: "device_1",
    senderUserId: "user_1",
    createdAt: joinedAt,
    kind: "chat.message",
    keyEpoch: 1,
    payload: { version: 3, algorithm: "AES-GCM-256", nonce: "nonce", ciphertext: "ciphertext" },
    ...overrides
  };
}

test("relay authorization rules cover every role transition and room membership boundary", () => {
  const store = new InMemoryRelayStore();
  store.teamMembers.set(
    "team_1",
    new Map([
      ["owner", member("owner", "owner")],
      ["admin", member("admin", "admin")],
      ["member", member("member", "member")]
    ])
  );
  store.rooms.set("room_1", { id: "room_1", teamId: "team_1" } as never);
  const authz = createRelayAuthz(store);

  assert.deepEqual(authz.teamIdsForUser("member"), new Set(["team_1"]));
  assert.equal(authz.isTeamMember("team_1", "missing"), false);
  assert.deepEqual(
    ["owner", "admin", "member"].map((role) => authz.teamRoleRank(role as never)),
    [0, 1, 2]
  );
  assert.equal(authz.canSetTeamMemberRole("owner", "member", "admin"), true);
  assert.equal(authz.canSetTeamMemberRole("admin", "member", "member"), true);
  assert.equal(authz.canSetTeamMemberRole("admin", "admin", "member"), false);
  assert.equal(authz.canSetTeamMemberRole("member", "member", "member"), false);
  assert.equal(authz.canSetTeamMemberRole("owner", "owner", "member"), false);
  assert.equal(authz.canSetTeamMemberRole("owner", "member", "owner"), false);
  assert.equal(authz.canRemoveTeamMember("owner", "admin"), true);
  assert.equal(authz.canRemoveTeamMember("admin", "member"), true);
  assert.equal(authz.canRemoveTeamMember("admin", "admin"), false);
  assert.equal(authz.canRemoveTeamMember(undefined, "owner"), false);
  assert.equal(authz.canAccessRoom("team_1", "room_1", "member"), true);
  assert.equal(authz.canAccessRoom("team_1", "room_1", "missing"), false);
  assert.equal(authz.canAccessRoom("other", "room_1", "member"), false);

  const transferred = authz.transferTeamOwnership(store.teamMembers.get("team_1")!, "member");
  assert.equal(transferred.get("member")?.role, "owner");
  assert.equal(transferred.get("owner")?.role, "admin");
  assert.equal(transferred.get("admin")?.role, "admin");
});

test("relay scalar and room-setting normalizers reject ambiguous or oversized input", () => {
  assert.equal(normalizeMetadataText(" value ", 10), "value");
  assert.equal(normalizeMetadataText("\u0000", 10), null);
  assert.equal(normalizeMetadataText("long", 3), null);
  assert.equal(normalizeRelayId("id_1", 10), "id_1");
  for (const value of [" id", "bad id", "", 3]) assert.equal(normalizeRelayId(value, 10), null);
  assert.equal(normalizeOptionalMetadataText(undefined, 10), "");
  assert.equal(normalizeOptionalMetadataText(" ok ", 10), "ok");
  assert.equal(isJsonStringifiableWithin({ ok: true }, 20), true);
  assert.equal(isJsonStringifiableWithin({ long: "value" }, 2), false);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(isJsonStringifiableWithin(circular, 20), false);
  assert.equal(parseIntegerValue("4.6", 1, 2, 4), 4);
  assert.equal(parseIntegerValue({}, 3, 1, 5), 3);
  assert.equal(parseIntegerValue(-2, 3, 1, 5), 1);
  assert.equal(maxCiphertextCharactersForBlob(0), 1430);
  assert.equal(isApprovalPolicy("ask_every_turn"), true);
  assert.equal(isApprovalPolicy("invalid"), false);
  assert.equal(isApprovalDelegationPolicy("trusted_members_only"), true);
  assert.equal(isApprovalDelegationPolicy("invalid"), false);
  assert.equal(isRoomMode({ chat: true, code: false, workspace: true, browser: false }), true);
  assert.equal(isRoomMode(null), false);
  assert.equal(isRoomMode({ chat: true }), false);
  assert.equal(normalizeRoomProjectPath(" /repo ", 20), "/repo");
  assert.equal(normalizeRoomProjectPath("\n", 20), null);
  assert.equal(normalizeCodexModel("gpt-custom/1", 30), "gpt-custom/1");
  assert.equal(normalizeCodexModel(" bad model ", 30), null);
  assert.equal(normalizeCodexReasoningEffort("medium"), "medium");
  assert.equal(normalizeCodexReasoningEffort("invalid"), null);
  assert.equal(normalizeCodexSpeed("standard"), "standard");
  assert.equal(normalizeCodexSpeed("invalid"), null);
  assert.equal(normalizeCodexCatalogSelectionPolicy("pinned"), "pinned");
  assert.equal(normalizeCodexCatalogSelectionPolicy("invalid"), null);
  assert.equal(normalizeCodexReasoningEffortOrDefault("invalid"), "medium");
  assert.equal(normalizeCodexSpeedOrDefault("invalid"), "standard");
  assert.equal(normalizeTeamRole("admin"), "admin");
  assert.equal(normalizeTeamRole("invalid"), "member");
});

test("public-key, browser-origin, envelope, and retention limits fail closed", () => {
  const jwk = { kty: "EC", crv: "P-256", x: "AQ", y: "Ag" };
  assert.deepEqual(normalizeDevicePublicKeyJwk(jwk, 200), jwk);
  assert.equal(normalizeDevicePublicKeyJwk({ ...jwk, d: "private" }, 200), null);
  assert.equal(normalizeDevicePublicKeyJwk(jwk, 2), null);
  assert.deepEqual(normalizeBrowserAllowedOrigins(["https://example.com", "https://example.com/"]), [
    "https://example.com"
  ]);
  for (const value of [
    "not-an-array",
    Array(21).fill("https://example.com"),
    [3],
    ["ftp://example.com"],
    ["https://example.com/path"],
    ["not a url"]
  ]) {
    assert.equal(normalizeBrowserAllowedOrigins(value), null);
  }
  assert.deepEqual(normalizeBrowserAllowedOrigins([" "]), []);

  const limits = {
    encryptedEnvelopeMaxBytes: 2_000,
    maxEnvelopeCiphertextChars: 100,
    maxEnvelopeIdChars: 30,
    maxEnvelopeNonceChars: 30,
    maxDeviceIdChars: 30,
    maxPublicKeyJwkChars: 200,
    maxUserIdChars: 30
  };
  const valid = envelope();
  assert.equal(isAllowedEnvelopePayload(valid), true);
  assert.equal(isRelayEnvelopeWithinLimits(valid, limits), true);
  for (const invalid of [
    envelope({ id: " ".repeat(2) }),
    envelope({ senderUserId: "x".repeat(31) }),
    envelope({ senderDeviceId: "x".repeat(31) }),
    envelope({ payload: { ...valid.payload, nonce: "x".repeat(31) } }),
    envelope({ payload: { ...valid.payload, ciphertext: "x".repeat(101) } })
  ])
    assert.equal(isRelayEnvelopeWithinLimits(invalid, limits), false);
  const sealed = envelope({
    kind: "room.invite",
    payload: {
      version: 3,
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
      ephemeralPublicKeyJwk: jwk,
      nonce: "n",
      ciphertext: "c"
    }
  });
  assert.equal(isAllowedEnvelopePayload(sealed), true);
  assert.equal(isRelayEnvelopeWithinLimits(sealed, limits), true);
  assert.equal(isRelayEnvelopeWithinLimits(sealed, { ...limits, maxPublicKeyJwkChars: 2 }), false);
  assert.equal(isAllowedEnvelopePayload({ ...sealed, kind: "chat.message" }), false);
  assert.equal(isRelayEnvelopeWithinLimits(valid, { ...limits, encryptedEnvelopeMaxBytes: 2 }), false);

  const old = envelope({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" });
  const recent = envelope({ id: "recent", createdAt: "2026-07-10T00:00:00.000Z" });
  const newest = envelope({ id: "newest", createdAt: "2026-07-11T00:00:00.000Z" });
  const pruned = pruneEncryptedBacklog([old, recent, newest], {
    ...limits,
    encryptedBacklogLimit: 1,
    encryptedBacklogRetentionDays: 2,
    now: () => Date.parse("2026-07-11T12:00:00.000Z")
  });
  assert.deepEqual(
    pruned.map(({ id }) => id),
    ["newest"]
  );
});

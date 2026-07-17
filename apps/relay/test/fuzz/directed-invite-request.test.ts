import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fc from "fast-check";
import { parseStrictDirectedInviteRequestJson } from "../../src/opaque.js";

const fuzzIterations = Number(process.env.MULTAIPLAYER_RELAY_FUZZ_ITERATIONS ?? 100_000);
const fuzzSeedText = process.env.MULTAIPLAYER_RELAY_FUZZ_SEED ?? "directed-invite-v3";
const fuzzSeed =
  [...fuzzSeedText].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261) |
  0;
if (!Number.isSafeInteger(fuzzIterations) || fuzzIterations < 1) {
  throw new Error("MULTAIPLAYER_RELAY_FUZZ_ITERATIONS must be a positive safe integer");
}

const boundedId = fc.stringMatching(/^[A-Za-z0-9_-]{3,40}$/);
const boundedText = fc.stringMatching(/^[A-Za-z0-9:_-]{1,40}$/);
const canonicalEnvelope = fc
  .record({
    inviteId: boundedText,
    teamId: boundedId,
    roomId: boundedId,
    keyEpoch: fc.nat({ max: Number.MAX_SAFE_INTEGER }),
    hash: fc
      .array(fc.constantFrom(..."0123456789abcdef"), { minLength: 64, maxLength: 64 })
      .map((value) => value.join("")),
    requestId: boundedText,
    requestNonce: fc.stringMatching(/^[A-Za-z0-9_-]{16,40}$/),
    requesterUserId: boundedText,
    requesterDeviceId: boundedText,
    hostUserId: boundedText,
    hostDeviceId: boundedText,
    encapsulatedKey: fc.uint8Array({ minLength: 65, maxLength: 65 }),
    ciphertext: fc.uint8Array({ minLength: 16, maxLength: 2_048 })
  })
  .map((value) =>
    JSON.stringify({
      version: 3,
      binding: {
        version: 3,
        phase: "request",
        inviteId: value.inviteId,
        teamId: value.teamId,
        roomId: value.roomId,
        keyEpoch: value.keyEpoch,
        keyPackageHash: `sha256:${value.hash}`,
        requestId: value.requestId,
        requestNonce: value.requestNonce,
        requesterUserId: value.requesterUserId,
        requesterDeviceId: value.requesterDeviceId,
        hostUserId: value.hostUserId,
        hostDeviceId: value.hostDeviceId,
        expiresAt: "2030-01-01T00:00:00.000Z",
        status: null,
        decidedAt: null
      },
      sealedPayload: {
        version: 1,
        kem_id: 16,
        kdf_id: 1,
        aead_id: 1,
        encapsulated_key: [...value.encapsulatedKey],
        ciphertext: [...value.ciphertext]
      }
    })
  );

test("checked-in directed invite corpus replays through the strict relay parser", () => {
  const corpus = JSON.parse(
    readFileSync(new URL("corpus/directed-invite-requests.json", import.meta.url), "utf8")
  ) as Array<{ name: string; expected: "accepted" | "rejected"; value: string }>;
  for (const entry of corpus) {
    assert.equal(
      parseStrictDirectedInviteRequestJson(entry.value, 1_400_000) !== null,
      entry.expected === "accepted",
      entry.name
    );
  }
});

test("generated canonical directed invite requests survive the exact parser", () => {
  fc.assert(
    fc.property(canonicalEnvelope, (value) => {
      assert.notEqual(parseStrictDirectedInviteRequestJson(value, 1_400_000), null);
    }),
    { seed: fuzzSeed, numRuns: Math.min(fuzzIterations, 10_000) }
  );
});

test("arbitrary and mutated directed invite input cannot crash the parser", () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.uint8Array({ maxLength: 16_384 }), fc.jsonValue({ maxDepth: 12 }), canonicalEnvelope),
      fc.nat(),
      fc.integer({ min: 0, max: 7 }),
      (input, offset, bit) => {
        const original =
          typeof input === "string"
            ? input
            : input instanceof Uint8Array
              ? Buffer.from(input).toString("utf8")
              : JSON.stringify(input);
        const bytes = Buffer.from(original);
        if (bytes.length > 0) {
          const position = offset % bytes.length;
          bytes[position] = bytes[position]! ^ (1 << bit);
        }
        assert.doesNotThrow(() => parseStrictDirectedInviteRequestJson(original, 1_400_000));
        assert.doesNotThrow(() => parseStrictDirectedInviteRequestJson(bytes.toString("utf8"), 1_400_000));
        assert.doesNotThrow(() =>
          parseStrictDirectedInviteRequestJson(original.slice(0, offset % (original.length + 1)), 1_400_000)
        );
      }
    ),
    { seed: fuzzSeed, numRuns: fuzzIterations }
  );
});

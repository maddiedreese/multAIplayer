import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fc from "fast-check";
import { isRecord, MlsRelayMessage, RelayClientMessage } from "@multaiplayer/protocol";
import { createRelayLimits, isJsonStringifiableWithin, normalizeMetadataText } from "../../src/limits.js";
import { parseRelayClientMessage } from "../../src/ws/connection-validation.js";

const fuzzSeedText = process.env.MULTAIPLAYER_RELAY_FUZZ_SEED ?? "mls-v3";
const fuzzIterations = Number(process.env.MULTAIPLAYER_RELAY_FUZZ_ITERATIONS ?? 100_000);
const fuzzPath = process.env.MULTAIPLAYER_RELAY_FUZZ_PATH;
const fuzzSeed =
  [...fuzzSeedText].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261) |
  0;

if (!Number.isSafeInteger(fuzzIterations) || fuzzIterations < 1) {
  throw new Error("MULTAIPLAYER_RELAY_FUZZ_ITERATIONS must be a positive safe integer");
}

const limits = createRelayLimits(1_500_000, {
  maxDisplayNameChars: 128,
  maxDeviceIdChars: 128,
  maxEnvelopeIdChars: 256,
  maxPublicKeyFingerprintChars: 256,
  maxPublicKeyJwkChars: 16_384,
  maxRoomProjectPathChars: 4096,
  maxUserIdChars: 128
});
const parserOptions = {
  limits,
  validation: { isJsonStringifiableWithin, isRecord, normalizeMetadataText }
} as Parameters<typeof parseRelayClientMessage>[0];
const propertyParameters = {
  seed: fuzzSeed,
  numRuns: fuzzIterations,
  ...(fuzzPath ? { path: fuzzPath } : {})
};

function parseRealBoundary(text: string): "accepted" | "rejected" {
  try {
    const result = parseRelayClientMessage(parserOptions, { toString: () => text });
    return result.message && !result.preflightError ? "accepted" : "rejected";
  } catch (error) {
    // Syntax and schema errors are the boundary's intentional rejection path.
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) return "rejected";
    throw error;
  }
}

const baseMessage = MlsRelayMessage.parse({
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  createdAt: "2026-07-13T00:00:00.000Z",
  messageType: "application",
  epochHint: 0,
  mlsMessage: "AA=="
});

const boundedId = fc.integer({ min: 0, max: 1_000_000 }).map((value) => `fuzz-id-${value}`);
const structureAwareMessages = fc.oneof(
  fc.record({
    type: fc.constant("join" as const),
    teamId: boundedId,
    roomId: boundedId,
    userId: boundedId,
    deviceId: boundedId,
    inviteId: fc.option(boundedId, { nil: undefined }),
    deviceSessionToken: fc.option(fc.string({ minLength: 32, maxLength: 256 }), { nil: undefined })
  }),
  fc.record({
    type: fc.constant("subscribe.team" as const),
    teamId: boundedId,
    userId: boundedId,
    deviceId: boundedId
  }),
  fc.record({ type: fc.constant("subscribe.workspace" as const), userId: boundedId, deviceId: boundedId }),
  fc.record({
    type: fc.constant("publish" as const),
    message: fc.record({
      id: boundedId,
      teamId: boundedId,
      roomId: boundedId,
      senderUserId: boundedId,
      senderDeviceId: boundedId,
      createdAt: fc.constant("2026-07-13T00:00:00.000Z"),
      messageType: fc.constantFrom("application" as const, "commit" as const),
      epochHint: fc.nat({ max: Number.MAX_SAFE_INTEGER }),
      mlsMessage: fc.uint8Array({ minLength: 1, maxLength: 4096 }).map((bytes) => Buffer.from(bytes).toString("base64"))
    })
  }),
  fc.record({
    type: fc.constant("presence" as const),
    teamId: boundedId,
    roomId: boundedId,
    userId: boundedId,
    deviceId: boundedId,
    displayName: boundedId
  })
);

test("checked-in relay frames replay through the real connection parser", () => {
  const corpus = JSON.parse(
    readFileSync(new URL("corpus/relay-client-messages.json", import.meta.url), "utf8")
  ) as Array<{ expected: "accepted" | "rejected"; frame: string }>;
  for (const entry of corpus) assert.equal(parseRealBoundary(entry.frame), entry.expected, entry.frame);
});

test("relay parsers never throw unexpectedly for generated transport bytes and recursive JSON", () => {
  fc.assert(
    fc.property(fc.oneof(fc.uint8Array({ maxLength: 16_384 }), fc.jsonValue({ maxDepth: 12 })), (input) => {
      const text = input instanceof Uint8Array ? Buffer.from(input).toString("utf8") : JSON.stringify(input);
      assert.doesNotThrow(() => parseRealBoundary(text));
    }),
    propertyParameters
  );
});

test("generated client-message variants survive the real JSON transport boundary", () => {
  fc.assert(
    fc.property(structureAwareMessages, (message) => {
      const frame = JSON.stringify(message);
      const decoded = JSON.parse(frame);
      assert.deepEqual(RelayClientMessage.parse(decoded), decoded);
      assert.equal(parseRealBoundary(frame), "accepted");
    }),
    { ...propertyParameters, numRuns: Math.min(fuzzIterations, 10_000) }
  );
});

test("truncated, reordered, and bit-flipped valid frames cannot crash the connection parser", () => {
  const messages = [
    { type: "join", teamId: "team-1", roomId: "room-1", userId: "user-1", deviceId: "device-1" },
    { type: "subscribe.team", teamId: "team-1", userId: "user-1", deviceId: "device-1" },
    { type: "subscribe.workspace", userId: "user-1", deviceId: "device-1" },
    { type: "publish", message: baseMessage },
    {
      type: "presence",
      teamId: "team-1",
      roomId: "room-1",
      userId: "user-1",
      deviceId: "device-1",
      displayName: "Fuzz User"
    }
  ] as const;
  fc.assert(
    fc.property(fc.constantFrom(...messages), fc.nat(), fc.integer({ min: 0, max: 7 }), (message, offset, bit) => {
      const frame = new TextEncoder().encode(JSON.stringify(message));
      const position = offset % frame.length;
      const flipped = frame.slice();
      flipped[position] ^= 1 << bit;
      const midpoint = Math.floor(frame.length / 2);
      const reordered = Buffer.concat([frame.slice(midpoint), frame.slice(0, midpoint)]).toString("utf8");
      assert.doesNotThrow(() => parseRealBoundary(Buffer.from(flipped).toString("utf8")));
      assert.doesNotThrow(() => parseRealBoundary(Buffer.from(frame.slice(0, position)).toString("utf8")));
      assert.doesNotThrow(() => parseRealBoundary(reordered));
    }),
    propertyParameters
  );
});

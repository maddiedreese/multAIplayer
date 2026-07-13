import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { MlsRelayMessage, RelayClientMessage } from "@multaiplayer/protocol";

const fuzzSeedText = process.env.MULTAIPLAYER_RELAY_FUZZ_SEED ?? "mls-v2";
const fuzzIterations = Number(process.env.MULTAIPLAYER_RELAY_FUZZ_ITERATIONS ?? 100_000);
const fuzzSeed =
  [...fuzzSeedText].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261) |
  0;

if (!Number.isSafeInteger(fuzzIterations) || fuzzIterations < 1) {
  throw new Error("MULTAIPLAYER_RELAY_FUZZ_ITERATIONS must be a positive safe integer");
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

const validMessages = [
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

function parseTransport(bytes: Uint8Array): unknown {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return RelayClientMessage.safeParse(JSON.parse(decoded));
  } catch {
    return null;
  }
}

test("relay parsers never throw for generated transport bytes and recursive JSON", () => {
  fc.assert(
    fc.property(fc.oneof(fc.uint8Array({ maxLength: 16_384 }), fc.jsonValue({ maxDepth: 12 })), (input) => {
      assert.doesNotThrow(() => {
        if (input instanceof Uint8Array) parseTransport(input);
        else RelayClientMessage.safeParse(input);
      });
    }),
    { seed: fuzzSeed, numRuns: fuzzIterations }
  );
});

test("every client-message variant survives JSON transport unchanged", () => {
  fc.assert(
    fc.property(fc.constantFrom(...validMessages), (message) => {
      const parsed = RelayClientMessage.parse(JSON.parse(JSON.stringify(message)));
      assert.deepEqual(parsed, message);
    }),
    { seed: fuzzSeed, numRuns: Math.min(fuzzIterations, 10_000) }
  );
});

test("truncated and bit-flipped valid frames cannot crash transport parsing", () => {
  const frames = validMessages.map((message) => new TextEncoder().encode(JSON.stringify(message)));
  fc.assert(
    fc.property(fc.constantFrom(...frames), fc.nat(), fc.integer({ min: 0, max: 7 }), (frame, offset, bit) => {
      const position = offset % frame.length;
      const flipped = frame.slice();
      flipped[position] ^= 1 << bit;
      assert.doesNotThrow(() => parseTransport(flipped));
      assert.doesNotThrow(() => parseTransport(frame.slice(0, position)));
    }),
    { seed: fuzzSeed, numRuns: fuzzIterations }
  );
});

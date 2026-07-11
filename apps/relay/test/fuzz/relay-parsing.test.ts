import assert from "node:assert/strict";
import test from "node:test";
import { RelayClientMessage, RelayEnvelope } from "@multaiplayer/protocol";

const iterations = positiveInteger(process.env.MULTAIPLAYER_RELAY_FUZZ_ITERATIONS, 5_000);
const initialSeed = unsignedInteger(process.env.MULTAIPLAYER_RELAY_FUZZ_SEED, 0x5eedc0de);

test(`relay message and envelope schemas survive ${iterations} fuzz cases (seed ${initialSeed})`, () => {
  const random = xorshift32(initialSeed);
  const validEnvelope = {
    id: "env-fuzz-seed",
    teamId: "team-fuzz",
    roomId: "room-fuzz",
    senderUserId: "user-fuzz",
    senderDeviceId: "device-fuzz",
    kind: "chat.message",
    createdAt: new Date(0).toISOString(),
    keyEpoch: 1,
    payload: { version: 3, algorithm: "AES-GCM-256", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AA==" }
  };
  const corpus: unknown[] = [
    null,
    {},
    [],
    { type: "publish", envelope: validEnvelope },
    validEnvelope,
    { ...validEnvelope, payload: null },
    { ...validEnvelope, keyEpoch: -1 },
    { type: "publish", envelope: { ...validEnvelope, kind: "unknown" } }
  ];

  assert.equal(RelayEnvelope.safeParse(validEnvelope).success, true, "fuzz seed envelope must remain valid");
  assert.equal(
    RelayClientMessage.safeParse({ type: "publish", envelope: validEnvelope }).success,
    true,
    "fuzz seed publish message must remain valid"
  );

  for (let index = 0; index < iterations; index += 1) {
    const candidate = index < corpus.length ? corpus[index] : fuzzCandidate(random, validEnvelope);
    assert.doesNotThrow(() => RelayClientMessage.safeParse(candidate));
    assert.doesNotThrow(() => RelayEnvelope.safeParse(candidate));

    const bytes = randomBytes(random, random() % 4097);
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    assert.doesNotThrow(() => RelayClientMessage.safeParse(decoded));
    assert.doesNotThrow(() => RelayEnvelope.safeParse(decoded));
  }
});

function fuzzCandidate(random: () => number, validEnvelope: Record<string, unknown>): unknown {
  if (random() % 3 === 0) return randomJson(random, 0);
  const envelope = structuredClone(validEnvelope);
  const fields = [
    "id",
    "teamId",
    "roomId",
    "senderUserId",
    "senderDeviceId",
    "kind",
    "createdAt",
    "keyEpoch",
    "payload"
  ];
  const mutationCount = 1 + (random() % 5);
  for (let index = 0; index < mutationCount; index += 1) {
    const field = fields[random() % fields.length];
    if (random() % 4 === 0) delete envelope[field];
    else envelope[field] = randomJson(random, 0);
  }
  return random() % 2 === 0 ? envelope : { type: random() % 3 === 0 ? "publish" : randomJson(random, 0), envelope };
}

function randomJson(random: () => number, depth: number): unknown {
  const choice = random() % (depth >= 4 ? 5 : 8);
  if (choice === 0) return null;
  if (choice === 1) return Boolean(random() & 1);
  if (choice === 2) return (random() | 0) / Math.max(1, random() % 17);
  if (choice === 3) return randomBytes(random, random() % 257).toString("utf8");
  if (choice === 4) return randomBytes(random, random() % 257).toString("base64");
  if (choice === 5) return Array.from({ length: random() % 9 }, () => randomJson(random, depth + 1));
  const record: Record<string, unknown> = {};
  for (let index = 0; index < random() % 9; index += 1) {
    record[randomBytes(random, random() % 33).toString("base64")] = randomJson(random, depth + 1);
  }
  return record;
}

function randomBytes(random: () => number, length: number): Buffer {
  return Buffer.from(Array.from({ length }, () => random() & 0xff));
}

function xorshift32(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function unsignedInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed >>> 0 : fallback;
}

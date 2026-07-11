import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  DevicePublicKeyJwk,
  RelayClientMessage,
  RelayEnvelope,
  RelayEnvelopeKind,
  RoomEnvelopeMetadata,
  RoomRecord,
  maxDeviceIdChars,
  maxEnvelopeIdChars,
  maxRoomIdChars,
  maxTeamIdChars,
  maxUserIdChars
} from "../src/index.js";

const relayId = (minimumLength: number, maximumLength: number) =>
  fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"),
    minLength: minimumLength,
    maxLength: maximumLength
  });

const metadataArbitrary = fc.record({
  id: fc.string({ minLength: 1, maxLength: maxEnvelopeIdChars }),
  teamId: relayId(3, maxTeamIdChars),
  roomId: relayId(3, maxRoomIdChars),
  senderDeviceId: fc.string({ minLength: 8, maxLength: maxDeviceIdChars }),
  senderUserId: fc.string({ minLength: 1, maxLength: maxUserIdChars }),
  createdAt: fc
    .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z"), noInvalidDate: true })
    .map((date) => date.toISOString()),
  kind: fc.constantFrom(...RelayEnvelopeKind.options),
  keyEpoch: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })
});

test("generated room envelope metadata survives validation and JSON transport", () => {
  fc.assert(
    fc.property(metadataArbitrary, (metadata) => {
      const parsed = RoomEnvelopeMetadata.parse(metadata);
      assert.deepEqual(RoomEnvelopeMetadata.parse(JSON.parse(JSON.stringify(parsed))), parsed);
    })
  );
});

test("generated publish envelopes survive validation and JSON transport", () => {
  fc.assert(
    fc.property(
      metadataArbitrary,
      fc.string({ minLength: 1, maxLength: 256 }),
      fc.string({ minLength: 1, maxLength: 256 }),
      (metadata, nonce, ciphertext) => {
        const message = {
          type: "publish" as const,
          envelope: {
            ...metadata,
            payload: { version: 3 as const, algorithm: "AES-GCM-256" as const, nonce, ciphertext }
          }
        };
        const parsed = RelayClientMessage.parse(message);
        assert.deepEqual(RelayClientMessage.parse(JSON.parse(JSON.stringify(parsed))), parsed);
        assert.equal(RelayEnvelope.safeParse(message.envelope).success, true);
      }
    )
  );
});

test("epoch and identifier bounds reject generated out-of-range metadata", () => {
  fc.assert(
    fc.property(metadataArbitrary, fc.integer({ max: 0 }), (metadata, invalidEpoch) => {
      assert.equal(RoomEnvelopeMetadata.safeParse({ ...metadata, keyEpoch: invalidEpoch }).success, false);
    })
  );
  fc.assert(
    fc.property(metadataArbitrary, fc.integer({ min: 1, max: 128 }), (metadata, excess) => {
      assert.equal(
        RoomEnvelopeMetadata.safeParse({ ...metadata, id: "x".repeat(maxEnvelopeIdChars + excess) }).success,
        false
      );
    })
  );
});

test("public device schemas never accept generated private key material", () => {
  const coordinate = relayId(1, 128);
  fc.assert(
    fc.property(coordinate, coordinate, fc.string({ minLength: 1 }), (x, y, d) => {
      assert.equal(DevicePublicKeyJwk.safeParse({ kty: "EC", crv: "P-256", x, y, d }).success, false);
    })
  );
});

test("room epoch counters accept only non-negative safe integers", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ max: -1 }),
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((value) => !Number.isInteger(value))
      ),
      (value) => {
        assert.equal(RoomRecord.shape.epochEnvelopeCount.safeParse(value).success, false);
      }
    )
  );
});

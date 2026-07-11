import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoomSecret } from "@multaiplayer/crypto";
import {
  createEncryptedRoomEnvelope,
  decryptRoomEnvelope,
  plaintextUserMatchesEnvelope
} from "../src/lib/encryptedEnvelope";

test("encrypted room envelopes bind ciphertext to canonical relay metadata", async () => {
  const secret = await createRoomSecret();
  const envelope = await createEncryptedRoomEnvelope(
    {
      id: "envelope-1",
      teamId: "team-1",
      roomId: "room-1",
      senderDeviceId: "device-1",
      senderUserId: "user-1",
      createdAt: "2026-07-10T12:00:00.000Z",
      kind: "chat.message",
      keyEpoch: 3
    },
    { authorUserId: "user-1", body: "private" },
    secret
  );

  assert.deepEqual(await decryptRoomEnvelope(envelope, secret), { authorUserId: "user-1", body: "private" });
  await assert.rejects(() => decryptRoomEnvelope({ ...envelope, senderUserId: "attacker" }, secret));
  await assert.rejects(() => decryptRoomEnvelope({ ...envelope, roomId: "other-room" }, secret));
  await assert.rejects(() => decryptRoomEnvelope({ ...envelope, keyEpoch: 4 }, secret));
});

test("plaintext actor ids must agree with authenticated envelope identity", () => {
  const envelope = { senderUserId: "user-1" };
  assert.equal(plaintextUserMatchesEnvelope(envelope, "user-1"), true);
  assert.equal(plaintextUserMatchesEnvelope(envelope, "attacker"), false);
  assert.equal(plaintextUserMatchesEnvelope(envelope, undefined), true);
});

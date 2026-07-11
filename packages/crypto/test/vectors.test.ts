import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  canonicalAuthenticatedRecord,
  type CanonicalAuthenticatedValue,
  unwrapRoomSecretAuthenticatedFromDevice
} from "../src/index";

interface CanonicalVector {
  name: string;
  domain: string;
  version: number;
  fields: Record<string, CanonicalAuthenticatedValue>;
  utf8: string;
  hex: string;
}

interface VectorFile {
  schema: string;
  canonicalAuthenticatedRecord: CanonicalVector[];
  authenticatedRoomSecretWrap: {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
    domain: string;
    version: 3;
    senderPublicKeyJwk: JsonWebKey;
    senderPrivateKeyJwk: JsonWebKey;
    recipientPublicKeyJwk: JsonWebKey;
    recipientPrivateKeyJwk: JsonWebKey;
    context: {
      purpose: "invite-response";
      teamId: string;
      roomId: string;
      senderUserId: string;
      senderDeviceId: string;
      recipientDeviceId: string;
      requestId: string;
      requestNonce: string;
      keyEpoch: number;
    };
    aadUtf8: string;
    aadHex: string;
    sharedSecretHex: string;
    hkdfSaltHex: string;
    nonceBase64: string;
    plaintextUtf8: string;
    ciphertextBase64: string;
  };
}

const vectors = JSON.parse(await readFile(new URL("../test-vectors/v1.json", import.meta.url), "utf8")) as VectorFile;
const decoder = new TextDecoder();

test("published canonical records match stable UTF-8 and hex vectors", () => {
  assert.equal(vectors.schema, "multaiplayer-crypto-test-vectors/v1");
  for (const vector of vectors.canonicalAuthenticatedRecord) {
    const encoded = canonicalAuthenticatedRecord(vector.domain, vector.version, vector.fields);
    assert.equal(decoder.decode(encoded), vector.utf8, vector.name);
    assert.equal(Buffer.from(encoded).toString("hex"), vector.hex, vector.name);
    assert.deepEqual(JSON.parse(vector.utf8), { domain: vector.domain, version: vector.version, ...vector.fields });
  }
});

test("canonical records have deterministic round trips under varied insertion order", () => {
  let state = 0x6d756c74;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const hostileStrings = [
    "",
    "plain",
    '"},"injected":true,{',
    "line\nnull\u0000tab\tbackslash\\",
    "<script>alert(1)</script>",
    "☃🚀é"
  ];
  const values: CanonicalAuthenticatedValue[] = [
    null,
    false,
    true,
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    ...hostileStrings
  ];

  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const entries: [string, CanonicalAuthenticatedValue][] = [];
    const fieldCount = 1 + (random() % 12);
    for (let index = 0; index < fieldCount; index += 1) {
      entries.push([`field${index}X${random() % 97}`, values[random() % values.length]!]);
    }
    entries.sort(() => (random() & 1 ? 1 : -1));
    const fields = Object.fromEntries(entries);
    const encoded = canonicalAuthenticatedRecord("multaiplayer:fuzz", 1, fields);
    const parsed = JSON.parse(decoder.decode(encoded));
    assert.deepEqual(parsed, { domain: "multaiplayer:fuzz", version: 1, ...fields });

    entries.reverse();
    assert.deepEqual(canonicalAuthenticatedRecord("multaiplayer:fuzz", 1, Object.fromEntries(entries)), encoded);
  }
});

test("canonical records reject field-name and scalar injection attempts", () => {
  for (const fieldName of ["domain", "version", "__proto__", "comma,name", 'quote"name', "line\nname", "é", "a.b"]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:fuzz", 1, { [fieldName]: "value" }));
  }
  for (const value of [1.5, Number.NaN, Infinity, -Infinity, 2 ** 53, {}, [], undefined, 1n]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:fuzz", 1, { value } as never));
  }
  for (const value of ["\ud800", "\udfff", "paired then lone 🚀\ud800"]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:fuzz", 1, { value }), /valid Unicode/);
  }
});

test("published authenticated key-wrap vector decrypts through the public implementation", async () => {
  const vector = vectors.authenticatedRoomSecretWrap;
  const aadFields = {
    ...vector.context,
    operationId: null,
    previousEpoch: null,
    newEpoch: null
  };
  const aad = canonicalAuthenticatedRecord("multaiplayer:authenticated-room-secret-wrap:v2", 1, aadFields);
  assert.equal(decoder.decode(aad), vector.aadUtf8);
  assert.equal(Buffer.from(aad).toString("hex"), vector.aadHex);

  const senderPrivateKey = await crypto.subtle.importKey(
    "jwk",
    vector.senderPrivateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    vector.recipientPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPublicKey },
    senderPrivateKey,
    256
  );
  assert.equal(Buffer.from(sharedSecret).toString("hex"), vector.sharedSecretHex);
  const salt = await crypto.subtle.digest("SHA-256", aad);
  assert.equal(Buffer.from(salt).toString("hex"), vector.hkdfSaltHex);
  const hkdfMaterial = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode(vector.domain)
    },
    hkdfMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const deterministicCiphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: Buffer.from(vector.nonceBase64, "base64"),
      additionalData: aad
    },
    wrappingKey,
    new TextEncoder().encode(vector.plaintextUtf8)
  );
  assert.equal(Buffer.from(deterministicCiphertext).toString("base64"), vector.ciphertextBase64);

  const secret = await unwrapRoomSecretAuthenticatedFromDevice(
    {
      version: vector.version,
      algorithm: vector.algorithm,
      senderPublicKeyJwk: vector.senderPublicKeyJwk as never,
      nonce: vector.nonceBase64,
      ciphertext: vector.ciphertextBase64
    },
    vector.recipientPrivateKeyJwk,
    vector.senderPublicKeyJwk,
    vector.context
  );
  assert.equal(JSON.stringify(secret), vector.plaintextUtf8);
});

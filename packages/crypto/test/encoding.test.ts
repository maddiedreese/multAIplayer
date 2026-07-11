import assert from "node:assert/strict";
import { test } from "node:test";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, toArrayBuffer } from "../src/encoding";

const vectors = [
  { bytes: [], base64: "", base64url: "" },
  { bytes: [0], base64: "AA==", base64url: "AA" },
  { bytes: [0, 1], base64: "AAE=", base64url: "AAE" },
  { bytes: [0, 1, 2], base64: "AAEC", base64url: "AAEC" },
  { bytes: [0xfb, 0xff, 0xff], base64: "+///", base64url: "-___" },
  { bytes: [0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], base64: "Zm9vYmFy", base64url: "Zm9vYmFy" }
] as const;

function assertInvalidBase64(value: string): void {
  assert.throws(
    () => base64ToBytes(value),
    (error: unknown) => error instanceof Error && error.message === "Invalid base64 encoding"
  );
}

function assertInvalidBase64Url(value: string): void {
  assert.throws(
    () => base64UrlToBytes(value),
    (error: unknown) => error instanceof Error && error.message === "Invalid base64url encoding"
  );
}

test("base64 codecs match canonical vectors", () => {
  for (const vector of vectors) {
    const bytes = Uint8Array.from(vector.bytes);
    assert.equal(bytesToBase64(bytes), vector.base64);
    assert.deepEqual(base64ToBytes(vector.base64), bytes);
    assert.equal(bytesToBase64Url(bytes), vector.base64url);
    assert.deepEqual(base64UrlToBytes(vector.base64url), bytes);
  }
});

test("base64 decoder rejects malformed and non-canonical encodings", () => {
  const invalid = ["A", "AA", "AAA", "AAAA=", "A===", "=AAA", "AA=A", "AA A", "AA\n==", "AA-_", "AB==", "AAF="];
  for (const value of invalid) assertInvalidBase64(value);
});

test("base64url decoder rejects malformed and non-canonical encodings", () => {
  const invalid = ["A", "AA==", "AA+/", "AA+_", "AA/_", "AA A", "AA\n", "AB", "AAF"];
  for (const value of invalid) assertInvalidBase64Url(value);
});

test("byte conversion returns an independent exact-length ArrayBuffer", () => {
  const source = Uint8Array.from([1, 2, 3]);
  const converted = toArrayBuffer(source);
  source[0] = 9;
  assert.equal(converted.byteLength, 3);
  assert.deepEqual(new Uint8Array(converted), Uint8Array.from([1, 2, 3]));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { canonicalAuthenticatedRecord, type CanonicalAuthenticatedValue } from "../src/canonical";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, toArrayBuffer } from "../src/encoding";

const decoder = new TextDecoder();
const fieldName = fc
  .tuple(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    fc.stringMatching(/^[A-Za-z0-9]{0,15}$/)
  )
  .map(([first, rest]) => `${first}${rest}`)
  .filter((name) => name !== "domain" && name !== "version");
const scalar: fc.Arbitrary<CanonicalAuthenticatedValue> = fc.oneof(
  fc.string({ maxLength: 64 }),
  fc.boolean(),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  fc.constant(null)
);
const record = fc.uniqueArray(fc.tuple(fieldName, scalar), { selector: ([name]) => name, maxLength: 16 });

test("canonical authenticated records round-trip and ignore field insertion order", () => {
  fc.assert(
    fc.property(record, fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (entries, version) => {
      const fields = Object.fromEntries(entries);
      const forward = canonicalAuthenticatedRecord("multaiplayer:property", version, fields);
      const reverse = canonicalAuthenticatedRecord(
        "multaiplayer:property",
        version,
        Object.fromEntries(entries.toReversed())
      );
      assert.deepEqual(reverse, forward);
      assert.deepEqual(JSON.parse(decoder.decode(forward)), { domain: "multaiplayer:property", version, ...fields });
      assert.deepEqual(
        Object.keys(JSON.parse(decoder.decode(forward))),
        ["domain", ...Object.keys(fields), "version"].sort()
      );
    }),
    { numRuns: 1_000 }
  );
});

test("canonical authenticated records are deterministic and domain separated", () => {
  fc.assert(
    fc.property(record, (entries) => {
      const fields = Object.fromEntries(entries);
      const encoded = canonicalAuthenticatedRecord("multaiplayer:property", 1, fields);
      assert.deepEqual(canonicalAuthenticatedRecord("multaiplayer:property", 1, fields), encoded);
      assert.notDeepEqual(canonicalAuthenticatedRecord("multaiplayer:other", 1, fields), encoded);
      assert.notDeepEqual(canonicalAuthenticatedRecord("multaiplayer:property", 2, fields), encoded);
    }),
    { numRuns: 500 }
  );
});

test("base64 codecs round-trip arbitrary bytes with canonical alphabets", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 4_096 }), (bytes) => {
      const base64 = bytesToBase64(bytes);
      const base64url = bytesToBase64Url(bytes);
      assert.deepEqual(base64ToBytes(base64), bytes);
      assert.deepEqual(base64UrlToBytes(base64url), bytes);
      assert.match(base64, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
      assert.match(base64url, /^[A-Za-z0-9_-]*$/);
      assert.equal(bytesToBase64(base64ToBytes(base64)), base64);
      assert.equal(bytesToBase64Url(base64UrlToBytes(base64url)), base64url);
    }),
    { numRuns: 1_000 }
  );
});

test("array-buffer conversion copies exactly the selected view", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 2, maxLength: 1_024 }), fc.nat(), fc.nat(), (source, first, length) => {
      const start = first % source.length;
      const selectedLength = length % (source.length - start + 1);
      const view = source.subarray(start, start + selectedLength);
      const expected = Uint8Array.from(view);
      const converted = toArrayBuffer(view);
      source.fill(0);
      assert.equal(converted.byteLength, expected.byteLength);
      assert.deepEqual(new Uint8Array(converted), expected);
    }),
    { numRuns: 500 }
  );
});

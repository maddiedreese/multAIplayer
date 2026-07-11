import assert from "node:assert/strict";
import test from "node:test";

import { canonicalAuthenticatedRecord, type CanonicalAuthenticatedValue } from "../src/index.js";

const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

test("canonical records accept every supported scalar and sort the complete record", () => {
  const fields: Record<string, CanonicalAuthenticatedValue> = {
    z9: null,
    A: false,
    a0: true,
    count: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    text: 'line\nquote"slash\\nul\u0000',
    unicode: "é☃🚀"
  };

  assert.equal(
    decode(canonicalAuthenticatedRecord("a:0._-z", 1, fields)),
    '{"A":false,"a0":true,"count":-9007199254740991,"domain":"a:0._-z","max":9007199254740991,"text":"line\\nquote\\\"slash\\\\nul\\u0000","unicode":"é☃🚀","version":1,"z9":null}'
  );
});

test("canonical records are independent of input insertion order", () => {
  const ascending = canonicalAuthenticatedRecord("multaiplayer:test", 7, { alpha: 1, middle: 2, zebra: 3 });
  const descending = canonicalAuthenticatedRecord("multaiplayer:test", 7, { zebra: 3, middle: 2, alpha: 1 });

  assert.deepEqual(descending, ascending);
});

test("canonical record domains are nonempty lowercase ASCII protocol identifiers", () => {
  for (const domain of ["a", "0", "multaiplayer:room-envelope_v2.test-name"]) {
    assert.doesNotThrow(() => canonicalAuthenticatedRecord(domain, 1, {}));
  }
  for (const domain of ["", ":prefix", "-prefix", "Uppercase", "white space", "é", "a/b", "a\n"]) {
    assert.throws(() => canonicalAuthenticatedRecord(domain, 1, {}), /domain and positive integer version/);
  }
});

test("canonical record versions are positive safe integers", () => {
  for (const version of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => canonicalAuthenticatedRecord("multaiplayer:test", version, {}));
  }
  for (const version of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => canonicalAuthenticatedRecord("multaiplayer:test", version, {}),
      /domain and positive integer version/
    );
  }
});

test("canonical field names are ASCII alphanumeric identifiers and cannot shadow framing fields", () => {
  for (const name of ["a", "Z", "field0", "Field9"]) {
    assert.doesNotThrow(() => canonicalAuthenticatedRecord("multaiplayer:test", 1, { [name]: null }));
  }
  for (const name of ["0field", "_field", "field-name", "field_name", "field.name", "field name", "é", ""]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:test", 1, { [name]: null }), /field name/);
  }
  for (const name of ["domain", "version"]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:test", 1, { [name]: null }), /Reserved/);
  }
});

test("canonical records reject every non-scalar and non-safe numeric value", () => {
  for (const value of [undefined, {}, [], 1n, Symbol("value"), () => undefined]) {
    assert.throws(
      () => canonicalAuthenticatedRecord("multaiplayer:test", 1, { value } as never),
      /Unsupported canonical authenticated field/
    );
  }
  for (const value of [1.5, -1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => canonicalAuthenticatedRecord("multaiplayer:test", 1, { value }),
      /Unsupported canonical authenticated field/
    );
  }
});

test("canonical strings accept valid surrogate pairs and reject lone surrogates", () => {
  for (const value of [
    "",
    "plain",
    "\ud7ff",
    "\ue000",
    "\ud800\udc00",
    "\udbff\udfff",
    "🚀",
    "before🚀after",
    "🚀🚀"
  ]) {
    assert.doesNotThrow(() => canonicalAuthenticatedRecord("multaiplayer:test", 1, { value }));
  }
  for (const value of [
    "\ud800",
    "\udbff",
    "\udc00",
    "\udfff",
    "🚀\ud800",
    "\udc00🚀",
    "\ud800x",
    "x\udc00",
    "\ud800x\udc00"
  ]) {
    assert.throws(() => canonicalAuthenticatedRecord("multaiplayer:test", 1, { value }), /valid Unicode/);
  }
});

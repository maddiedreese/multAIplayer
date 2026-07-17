import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocalPreviewUrl } from "../src/lib/files/localPreview";

test("local preview URLs only allow local http and https URLs with explicit ports", () => {
  assert.equal(normalizeLocalPreviewUrl(" http://localhost:3000 "), "http://localhost:3000/");
  assert.equal(normalizeLocalPreviewUrl("https://127.0.0.1:5173/path?q=1#secret"), "https://127.0.0.1:5173/path?q=1");

  assert.throws(() => normalizeLocalPreviewUrl("http://example.com:3000"), /localhost or 127\.0\.0\.1/);
  assert.throws(() => normalizeLocalPreviewUrl("file:///tmp/index.html"), /http/);
  assert.throws(() => normalizeLocalPreviewUrl("http://localhost"), /port/);
});

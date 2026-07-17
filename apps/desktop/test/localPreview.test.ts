import assert from "node:assert/strict";
import test from "node:test";
import { isTryCloudflareUrl, localPreviewDetectionUrls, normalizeLocalPreviewUrl } from "../src/lib/files/localPreview";

test("local preview detection covers common localhost and 127.0.0.1 dev ports", () => {
  const urls = localPreviewDetectionUrls();
  assert.ok(urls.includes("http://localhost:3000/"));
  assert.ok(urls.includes("http://127.0.0.1:5173/"));
  assert.ok(urls.includes("http://localhost:8888/"));
});

test("local preview URLs only allow local http and https URLs with explicit ports", () => {
  assert.equal(normalizeLocalPreviewUrl(" http://localhost:3000 "), "http://localhost:3000/");
  assert.equal(normalizeLocalPreviewUrl("https://127.0.0.1:5173/path?q=1#secret"), "https://127.0.0.1:5173/path?q=1");

  assert.throws(() => normalizeLocalPreviewUrl("http://example.com:3000"), /localhost or 127\.0\.0\.1/);
  assert.throws(() => normalizeLocalPreviewUrl("file:///tmp/index.html"), /http/);
  assert.throws(() => normalizeLocalPreviewUrl("http://localhost"), /port/);
});

test("trycloudflare URL helper accepts only generated public tunnel URLs", () => {
  assert.equal(isTryCloudflareUrl("https://demo.trycloudflare.com"), true);
  assert.equal(isTryCloudflareUrl("http://demo.trycloudflare.com"), false);
  assert.equal(isTryCloudflareUrl("https://trycloudflare.com.evil.example"), false);
});

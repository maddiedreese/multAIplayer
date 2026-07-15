import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageThumbnail,
  normalizeGeneratedImageData,
  safeGeneratedImageName
} from "../src/application/codex/codexGeneratedImage";

test("normalizes bounded generated-image base64 without accepting remote URLs", () => {
  assert.equal(
    normalizeGeneratedImageData({ data: "aGVsbG8=", mimeType: "image/png" }),
    "data:image/png;base64,aGVsbG8="
  );
  assert.equal(
    normalizeGeneratedImageData({ data: "data:image/webp;base64,aGVsbG8=", mimeType: "image/webp" }),
    "data:image/webp;base64,aGVsbG8="
  );
  assert.throws(
    () => normalizeGeneratedImageData({ data: "https://example.com/image.png", mimeType: "image/png" }),
    /malformed/
  );
  assert.throws(
    () => normalizeGeneratedImageData({ data: "data:image/jpeg;base64,aGVsbG8=", mimeType: "image/png" }),
    /did not match/
  );
});

test("creates safe stable generated-image names", () => {
  assert.equal(safeGeneratedImageName("sunset", "image/png"), "sunset.png");
  assert.equal(safeGeneratedImageName("../private/sunset.JPG", "image/jpeg"), "..-private-sunset.jpg");
  assert.equal(safeGeneratedImageName("", "image/webp"), "codex-image.webp");
});

test("creates a bounded inline thumbnail for an oversized image attachment", async () => {
  class TestImage {
    naturalWidth = 1_200;
    naturalHeight = 600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  const context = {
    fillStyle: "",
    fillRect() {},
    drawImage() {}
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => "data:image/jpeg;base64,aGVsbG8="
  };
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas }
  });
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  try {
    assert.equal(await createImageThumbnail("data:image/png;base64,iVBORw0KGgo="), "data:image/jpeg;base64,aGVsbG8=");
    assert.equal(canvas.width, 960);
    assert.equal(canvas.height, 480);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "Image", { configurable: true, value: previousImage });
  }
});

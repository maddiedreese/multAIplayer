import assert from "node:assert/strict";
import test from "node:test";
import { resolveFilePreviewTab } from "../src/lib/filePreview";

test("resolveFilePreviewTab keeps diff selected only when a diff exists", () => {
  assert.equal(resolveFilePreviewTab("diff", true), "diff");
  assert.equal(resolveFilePreviewTab("diff", false), "file");
});

test("resolveFilePreviewTab keeps file preview selected", () => {
  assert.equal(resolveFilePreviewTab("file", true), "file");
  assert.equal(resolveFilePreviewTab("file", false), "file");
});

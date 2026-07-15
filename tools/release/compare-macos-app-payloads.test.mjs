import assert from "node:assert/strict";
import test from "node:test";
import { compareManifests } from "./compare-macos-app-payloads.mjs";

test("payload manifest comparison reports additions and changed content", () => {
  const left = [{ path: "Contents/a", type: "file", sha256: "a" }];
  assert.deepEqual(compareManifests(left, structuredClone(left)), []);
  assert.deepEqual(
    compareManifests(left, [
      { path: "Contents/a", type: "file", sha256: "b" },
      { path: "Contents/b", type: "file", sha256: "c" }
    ]).map(({ path }) => path),
    ["Contents/a", "Contents/b"]
  );
});

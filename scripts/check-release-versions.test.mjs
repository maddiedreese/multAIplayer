import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReleaseVersions } from "./check-release-versions.mjs";

test("release version check accepts matching Cargo metadata", () => {
  assert.doesNotThrow(() =>
    assertReleaseVersions("0.1.0-alpha.0", {
      packages: [
        { name: "dependency", version: "9.0.0" },
        { name: "multaiplayer", version: "0.1.0-alpha.0" }
      ]
    })
  );
});

test("release version check rejects a missing or stale native package", () => {
  assert.throws(() => assertReleaseVersions("0.1.0", { packages: [] }), /must contain/);
  assert.throws(
    () => assertReleaseVersions("0.1.0", { packages: [{ name: "multaiplayer", version: "0.0.9" }] }),
    /must match/
  );
});

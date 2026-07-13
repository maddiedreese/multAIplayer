import assert from "node:assert/strict";
import test from "node:test";

import { synchronizeCargoLockVersion } from "./sync-release-metadata.mjs";

test("synchronizes the native package version without touching dependencies", () => {
  const lockfile = `[[package]]\nname = "multaiplayer"\nversion = "0.1.0-alpha.0"\ndependencies = [\n "rand",\n]\n`;
  assert.equal(
    synchronizeCargoLockVersion(lockfile, "0.1.1-alpha.0"),
    lockfile.replace("0.1.0-alpha.0", "0.1.1-alpha.0")
  );
});

test("fails closed for invalid versions and ambiguous lockfiles", () => {
  const stanza = `[[package]]\nname = "multaiplayer"\nversion = "0.1.0-alpha.0"\n`;
  assert.throws(() => synchronizeCargoLockVersion(stanza, "0.1.1\nmalicious"), /invalid release version/);
  assert.throws(() => synchronizeCargoLockVersion("", "0.1.1-alpha.0"), /found 0/);
  assert.throws(() => synchronizeCargoLockVersion(stanza + stanza, "0.1.1-alpha.0"), /found 2/);
});

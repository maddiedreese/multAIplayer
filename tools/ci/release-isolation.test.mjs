import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("CLI packaging remains independent from desktop release inputs", () => {
  assert.equal(existsSync(resolve(root, "apps/cli/Cargo.toml")), true);
  assert.equal(existsSync(resolve(root, "apps/cli/Cargo.lock")), true);
  assert.equal(existsSync(resolve(root, "apps/cli/package.json")), false);

  for (const path of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "scripts/check-release-versions.mjs",
    "tools/release/sync-release-metadata.mjs"
  ]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.equal(source.includes("apps/cli"), false, `${path} must not include CLI packaging`);
  }
});

test("CLI publication has an independent exact-source release workflow", () => {
  const cliRelease = readFileSync(resolve(root, ".github/workflows/cli-release.yml"), "utf8");
  assert.match(cliRelease, /cli-v\*/);
  assert.match(cliRelease, /node apps\/cli\/release\/package-cli\.mjs/);
  assert.match(cliRelease, /xcrun notarytool submit/);
  assert.match(cliRelease, /codesign -vvvv -R='notarized' --check-notarization/);
  assert.match(cliRelease, /CLI_APPLE_PROVISIONING_PROFILE/);
  assert.match(cliRelease, /gh release create/);
  assert.match(
    cliRelease,
    /Install locked repository dependencies[\s\S]*npm ci --ignore-scripts[\s\S]*Run the complete locked CLI gate/
  );
  assert.doesNotMatch(cliRelease, /apps\/desktop|tauri|updater/);
});

test("ordinary CI requires selected CLI checks and does not change the release workflow", () => {
  const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
  assert.match(ci, /^(?: {2})cli-core:\n/m);
  assert.match(ci, /if: needs\.changes\.outputs\.cli == 'true'/);
  assert.match(ci, /uses: \.\/\.github\/actions\/setup-node-npm/);
  assert.match(ci, /require_when_changed "\$CLI_CHANGED" "\$CLI_RESULT"/);
  assert.doesNotMatch(release, /apps\/cli|run-cli-checks|cli-core/);
});

test("desktop release validates the imported signing identity by profile fingerprint", () => {
  const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /profile_fingerprint=/);
  assert.match(release, /security find-identity -v -p codesigning build\.keychain/);
  assert.match(release, /grep -F "\$profile_fingerprint"[\s\S]*grep -Fq "\$APPLE_SIGNING_IDENTITY"/);
  assert.doesNotMatch(release, /security find-certificate/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

test("release workflow requires Apple signing and notarization secrets", () => {
  for (const secret of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "KEYCHAIN_PASSWORD"
  ]) {
    assert.match(releaseWorkflow, new RegExp(`secrets\\.${secret}`), `${secret} secret must be wired into release.yml`);
    assert.match(releaseWorkflow, new RegExp(`\\b${secret}\\b`), `${secret} must be checked before release build`);
  }

  assert.match(releaseWorkflow, /Missing Apple signing\/notarization secret\(s\)/);
  assert.match(releaseWorkflow, /Public release artifacts must be Developer ID signed and notarized/);
});

test("release workflow validates signed and notarized macOS artifacts", () => {
  assert.match(releaseWorkflow, /codesign --verify --deep --strict/);
  assert.match(releaseWorkflow, /xcrun stapler validate "\$app_path"/);
  assert.match(releaseWorkflow, /xcrun stapler validate "\$dmg_path"/);
  assert.match(releaseWorkflow, /spctl -a -vvv -t install "\$app_path"/);
  assert.match(releaseWorkflow, /spctl -a -vvv -t open --context context:primary-signature "\$dmg_path"/);
  assert.match(releaseWorkflow, /shasum -a 256 \* > SHA256SUMS\.txt/);
});

test("release workflow packages the frontend already produced by preflight", () => {
  assert.match(releaseWorkflow, /run: npm run release:preflight/);
  assert.match(releaseWorkflow, /run: npm run tauri:build:prebuilt -w @multaiplayer\/desktop/);
  assert.doesNotMatch(releaseWorkflow, /run: npm run tauri:build -w @multaiplayer\/desktop/);
});

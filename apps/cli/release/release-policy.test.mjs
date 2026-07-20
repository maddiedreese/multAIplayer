import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  artifactStem,
  assertNoProtectedEntitlements,
  assertSignatureMetadataMatchesObserved,
  assertSafeOutputDirectory,
  bindProvisioningProfileToSigningCertificate,
  parseCodeSignatureDetails,
  parseCargoPackageVersion,
  readReleaseConfig,
  signingArguments,
  validateDependencyLicenses,
  validateProtectedEntitlements,
  validateProvisioningProfile,
  validateSignatureMetadata
} from "./release-lib.mjs";

const root = resolve(import.meta.dirname, "../../..");
const config = readReleaseConfig();

test("CLI release identity is independent and matches its Cargo package", () => {
  const cargo = readFileSync(resolve(root, "apps/cli/Cargo.toml"), "utf8");
  const desktop = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
  assert.equal(parseCargoPackageVersion(cargo), config.version);
  assert.notEqual(config.version, desktop.version);
  assert.equal(config.binary, "multAIplayer");
  assert.equal(config.bundle, "multAIplayer.app");
  assert.equal(config.bundleIdentifier, "com.multaiplayer.cli");
  assert.equal(config.teamIdentifier, "AXP55K75AX");
  assert.equal(config.keychainAccessGroup, "AXP55K75AX.com.multaiplayer.cli");
  assert.equal(config.profileKeychainAccessGroup, "AXP55K75AX.*");
  assert.equal(artifactStem(config), `multAIplayer-cli-v${config.version}-darwin-arm64`);
});

test("Cargo package version parsing handles section boundaries and absolute EOF", () => {
  assert.equal(parseCargoPackageVersion('[package]\nversion = "1.2.3"\n\n[[bin]]\nname = "example"\n'), "1.2.3");
  assert.equal(parseCargoPackageVersion('[package]\nversion = "1.2.3"'), "1.2.3");
  assert.throws(() => parseCargoPackageVersion('[workspace]\nversion = "1.2.3"'));
  assert.throws(() => parseCargoPackageVersion('[package]\nname = "example"'));
});

test("CLI packaging is local-only and cannot publish or mutate desktop release inputs", () => {
  const sources = ["package-cli.mjs", "verify-package.mjs", "release-lib.mjs"]
    .map((name) => readFileSync(new URL(name, import.meta.url), "utf8"))
    .join("\n");
  for (const forbidden of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "tools/release/",
    "apps/desktop/src-tauri/Cargo.lock",
    "gh release",
    "git tag",
    "git push",
    "notarytool"
  ]) {
    assert.equal(sources.includes(forbidden), false, `CLI packaging must not reference ${forbidden}`);
  }
  assert.match(sources, /manual-owner-approval-required/);
  assert.match(sources, /desktopReleaseContract/);
});

test("public CLI packaging requires the explicit stable app and provisioning boundary", () => {
  const packager = readFileSync(new URL("package-cli.mjs", import.meta.url), "utf8");
  const verifier = readFileSync(new URL("verify-package.mjs", import.meta.url), "utf8");
  assert.match(packager, /MULTAIPLAYER_CLI_PROVISIONING_PROFILE/);
  assert.match(packager, /--provisioning-profile/);
  assert.match(packager, /inspectProvisioningProfile/);
  assert.match(packager, /inspectSigningCertificate/);
  assert.match(packager, /inspectSignedEntitlements/);
  assert.match(packager, /assertNoProtectedEntitlements/);
  assert.match(packager, /embedded\.provisionprofile/);
  assert.match(packager, /cli\.entitlements\.plist/);
  assert.match(packager, /"fetch", "--locked", "--manifest-path"/);
  assert.match(packager, /\["metadata", "--locked", "--offline"/);
  assert.match(verifier, /validateProtectedEntitlements/);
  assert.match(verifier, /assertNoProtectedEntitlements/);
  assert.match(verifier, /bindProvisioningProfileToSigningCertificate/);
});

test("profile authorization binds the exact leaf fingerprint, never a duplicate common name", () => {
  const authorizedDer = Buffer.from("authorized signing certificate DER fixture");
  const otherDer = Buffer.from("different certificate with the same common-name fixture");
  const authorizedSha256 = createHash("sha256").update(authorizedDer).digest("hex");
  const signer = { sha256: authorizedSha256, commonName: "Developer ID Application: duplicate name" };
  const profile = {
    DeveloperCertificates: [otherDer.toString("base64"), authorizedDer.toString("base64")]
  };
  assert.equal(bindProvisioningProfileToSigningCertificate(profile, signer), authorizedSha256);
  assert.throws(() =>
    bindProvisioningProfileToSigningCertificate({ DeveloperCertificates: [otherDer.toString("base64")] }, signer)
  );
  assert.throws(() =>
    bindProvisioningProfileToSigningCertificate(
      { DeveloperCertificates: [authorizedDer.toString("base64"), authorizedDer.toString("base64")] },
      signer
    )
  );
  assert.throws(() =>
    bindProvisioningProfileToSigningCertificate({ DeveloperCertificates: ["not certificate data"] }, signer)
  );
});

test("package output rejects symlink escapes before external mutation", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "multaiplayer-cli-output-safety-"));
  const workspace = resolve(fixture, "workspace");
  const external = resolve(fixture, "external");
  const sentinel = resolve(external, "sentinel.txt");
  try {
    mkdirSync(workspace);
    mkdirSync(external);
    writeFileSync(sentinel, "preserve me\n");

    symlinkSync(external, resolve(workspace, "link"));
    assert.throws(() => assertSafeOutputDirectory(workspace, resolve(workspace, "link/package")));
    assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");

    symlinkSync(external, resolve(workspace, "dist"));
    assert.throws(() => assertSafeOutputDirectory(workspace, resolve(workspace, "dist")));
    assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");
    assert.equal(existsSync(sentinel), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("ad-hoc and Developer ID bundle signing modes are explicit and cannot be confused", () => {
  assert.deepEqual(signingArguments("-", "/tmp/multAIplayer.app"), [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    "/tmp/multAIplayer.app"
  ]);
  assert.deepEqual(
    signingArguments(
      "Developer ID Application: Example (AXP55K75AX)",
      "/tmp/multAIplayer.app",
      "/tmp/cli.entitlements.plist"
    ),
    [
      "--force",
      "--sign",
      "Developer ID Application: Example (AXP55K75AX)",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      "/tmp/cli.entitlements.plist",
      "/tmp/multAIplayer.app"
    ]
  );

  const adhoc = {
    mode: "adhoc-local-verification",
    identityKind: "adhoc",
    secureTimestamp: false,
    authority: null,
    teamIdentifier: null,
    timestamp: null,
    hardenedRuntime: false
  };
  const developerId = {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: true,
    authority: "Developer ID Application: Example (ABCDEFGHIJ)",
    teamIdentifier: "ABCDEFGHIJ",
    timestamp: "Jul 19, 2026 at 12:00:00 PM",
    hardenedRuntime: true
  };
  assert.doesNotThrow(() => validateSignatureMetadata(adhoc));
  assert.doesNotThrow(() => validateSignatureMetadata(developerId));
  assert.throws(() => validateSignatureMetadata({ ...adhoc, mode: developerId.mode }));
  assert.throws(() => validateSignatureMetadata({ ...developerId, secureTimestamp: false }));
});

test("Developer ID profile and signed entitlements bind the stable non-interactive Keychain identity", () => {
  const protectedEntitlements = {
    "com.apple.application-identifier": config.keychainAccessGroup,
    "com.apple.developer.team-identifier": config.teamIdentifier,
    "keychain-access-groups": [config.keychainAccessGroup]
  };
  assert.doesNotThrow(() => validateProtectedEntitlements(protectedEntitlements, config));
  assert.throws(() => validateProtectedEntitlements({ ...protectedEntitlements, "get-task-allow": true }, config));
  assert.throws(() =>
    validateProtectedEntitlements(
      { ...protectedEntitlements, "keychain-access-groups": [config.keychainAccessGroup, "unexpected.group"] },
      config
    )
  );

  const profile = {
    UUID: "00000000-0000-0000-0000-000000000000",
    Name: "multAIplayer CLI Developer ID",
    TeamIdentifier: [config.teamIdentifier],
    ApplicationIdentifierPrefix: [config.teamIdentifier],
    ProvisionsAllDevices: true,
    ExpirationDate: "2099-01-01T00:00:00.000Z",
    Entitlements: {
      ...protectedEntitlements,
      "keychain-access-groups": [config.profileKeychainAccessGroup]
    }
  };
  assert.deepEqual(validateProvisioningProfile(profile, config, new Date("2026-07-20T00:00:00.000Z")), {
    uuid: profile.UUID,
    name: profile.Name,
    expiration: profile.ExpirationDate,
    teamIdentifier: config.teamIdentifier,
    applicationIdentifier: config.keychainAccessGroup,
    keychainAccessGroups: [config.profileKeychainAccessGroup]
  });
  assert.throws(() => validateProvisioningProfile({ ...profile, ProvisionsAllDevices: false }, config));
  assert.throws(() => validateProvisioningProfile({ ...profile, ProvisionedDevices: ["device"] }, config));
  assert.throws(() => validateProvisioningProfile({ ...profile, ExpirationDate: "2020-01-01T00:00:00.000Z" }, config));
  assert.throws(() =>
    validateProvisioningProfile(
      {
        ...profile,
        Entitlements: { ...profile.Entitlements, "keychain-access-groups": [config.keychainAccessGroup] }
      },
      config
    )
  );
  assert.throws(() =>
    validateProvisioningProfile(
      { ...profile, Entitlements: { ...profile.Entitlements, "get-task-allow": true } },
      config
    )
  );

  assert.doesNotThrow(() => assertNoProtectedEntitlements({}, config));
  assert.throws(() => assertNoProtectedEntitlements(protectedEntitlements, config));
});

test("observed codesign metadata rejects forged Developer ID and mode claims", () => {
  const observedAdhoc = parseCodeSignatureDetails(
    "Executable=/tmp/multAIplayer\nSignature=adhoc\nTeamIdentifier=not set\n"
  );
  const forgedDeveloperId = {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: true,
    authority: "Developer ID Application: Forged (ABCDEFGHIJ)",
    teamIdentifier: "ABCDEFGHIJ",
    timestamp: "Jul 19, 2026 at 12:00:00 PM",
    hardenedRuntime: true
  };
  assert.throws(() => assertSignatureMetadataMatchesObserved(observedAdhoc, forgedDeveloperId));

  const observedDeveloperId = parseCodeSignatureDetails(
    "Executable=/tmp/multAIplayer\nAuthority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nTimestamp=Jul 19, 2026 at 12:00:00 PM\nRuntime Version=15.6.0\n"
  );
  assert.throws(() => assertSignatureMetadataMatchesObserved(observedDeveloperId, observedAdhoc));
  assert.doesNotThrow(() =>
    assertSignatureMetadataMatchesObserved(observedDeveloperId, {
      ...forgedDeveloperId,
      authority: "Developer ID Application: Example (ABCDEFGHIJ)"
    })
  );
});

test("dependency license expressions are fail-closed against the reviewed release allowlist", () => {
  const reviewed = [{ name: "reviewed", version: "1.0.0", license: config.allowedLicenseExpressions[0] }];
  assert.doesNotThrow(() => validateDependencyLicenses(reviewed, config.allowedLicenseExpressions));
  assert.throws(() =>
    validateDependencyLicenses(
      [{ name: "unknown", version: "1.0.0", license: "LicenseRef-Unreviewed" }],
      config.allowedLicenseExpressions
    )
  );
  assert.throws(() =>
    validateDependencyLicenses([{ name: "missing", version: "1.0.0" }], config.allowedLicenseExpressions)
  );
  assert.throws(() =>
    validateDependencyLicenses(
      [{ name: "license-file-only", version: "1.0.0", license_file: "LICENSE.txt" }],
      config.allowedLicenseExpressions
    )
  );
});

test("desktop release contracts contain no CLI package reference", () => {
  for (const path of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "scripts/check-release-versions.mjs",
    "tools/release/sync-release-metadata.mjs"
  ]) {
    assert.doesNotMatch(readFileSync(resolve(root, path), "utf8"), /apps\/cli|multAIplayer-cli/);
  }
});

test("macOS release workflows embed and independently verify the pinned Developer ID chain", () => {
  const expectedIntermediate = "f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a";
  for (const path of [".github/workflows/release.yml", ".github/workflows/cli-release.yml"]) {
    const workflow = readFileSync(resolve(root, path), "utf8");
    assert.ok(workflow.includes("https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"));
    assert.match(workflow, new RegExp(expectedIntermediate));
    assert.match(workflow, /security import "\$developer_id_g2"/);
    assert.match(workflow, /security find-certificate/);
    assert.match(workflow, /keychain_g2_der/);
    assert.match(workflow, /security list-keychains -d user -s build\.keychain/);
    assert.match(workflow, /--extract-certificates=\$\{certificate_prefix\}/);
    assert.match(workflow, /test -s "\$\{certificate_prefix\}1"/);
    assert.match(workflow, /temporary-verification-only/);
    assert.match(workflow, /codesign --keychain "\$verification_keychain" --verify --deep --strict/);
  }

  const releaseLibrary = readFileSync(new URL("release-lib.mjs", import.meta.url), "utf8");
  assert.match(releaseLibrary, /the Developer ID signature has no embedded intermediate certificate/);
});

test("public installer is version-bound and fails closed on Apple release trust", () => {
  const installerPath = resolve(root, "apps/cli/install.sh");
  const installer = readFileSync(installerPath, "utf8");
  const syntax = spawnSync("sh", ["-n", installerPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.notEqual(statSync(installerPath).mode & 0o111, 0, "installer must remain executable");
  assert.match(installer, new RegExp(`version="${config.version.replaceAll(".", "\\.")}"`));
  assert.match(installer, /tag="cli-v\$\{version\}"/);
  assert.match(installer, /github\.com\/\$\{repository\}\/releases\/download\/\$\{tag\}/);
  assert.match(installer, /shasum -a 256 -c/);
  assert.match(installer, /signature_mode.*developer-id-distribution/s);
  assert.match(installer, /bundle_id="com\.multaiplayer\.cli"/);
  assert.match(installer, /team_id="AXP55K75AX"/);
  assert.match(installer, /keychain_group="AXP55K75AX\.com\.multaiplayer\.cli"/);
  assert.match(installer, /embedded\.provisionprofile/);
  assert.match(installer, /codesign -d --entitlements/);
  assert.match(installer, /security cms -D -i/);
  assert.match(installer, /--extract-certificates=/);
  assert.match(installer, /DeveloperCertificates/);
  assert.match(installer, /profile_signer_matches.*-eq 1/s);
  assert.match(installer, /tar -tvzf/);
  assert.match(installer, /unexpected or missing entries/);
  assert.match(installer, /link, device, or unexpected entry type/);
  assert.ok(
    installer.indexOf("typed_entries=") < installer.indexOf('tar -xzf "${temporary}/${archive}"'),
    "archive entry names and types must be validated before extraction"
  );
  assert.match(installer, /binarySha256/);
  assert.match(installer, /MultAIplayerCLIVersion/);
  assert.match(installer, /expected_version_output="multAIplayer \$\{version\}"/);
  assert.match(installer, /Library\/Application Support\/multAIplayer\/cli/);
  assert.match(installer, /\.local\/bin/);
  assert.doesNotMatch(installer, /sudo/);
  assert.match(installer, /Developer ID Application:/);
  assert.match(installer, /observed_team.*claimed_team/s);
  assert.match(installer, /observed_timestamp.*claimed_timestamp/s);
  assert.match(installer, /codesign -vvvv -R='notarized' --check-notarization/);
  assert.doesNotMatch(installer, /spctl --assess/);
  assert.doesNotMatch(installer, /--sign|-k |notarytool|gh release|git push/);
});

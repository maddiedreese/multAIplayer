import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export const releaseRoot = new URL("./", import.meta.url);

export function readReleaseConfig() {
  const config = JSON.parse(readFileSync(new URL("release-config.json", releaseRoot), "utf8"));
  assert.equal(config.schema, "multaiplayer-cli-release-v1");
  assert.equal(config.product, "multAIplayer CLI");
  assert.equal(config.binary, "multAIplayer");
  assert.equal(config.bundle, "multAIplayer.app");
  assert.equal(config.bundleIdentifier, "com.multaiplayer.cli");
  assert.equal(config.teamIdentifier, "AXP55K75AX");
  assert.equal(config.keychainAccessGroup, "AXP55K75AX.com.multaiplayer.cli");
  assert.match(config.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(config.target, "aarch64-apple-darwin");
  assert.equal(config.platform, "darwin-arm64");
  assert.equal(config.archivePrefix, "multAIplayer-cli");
  assert.equal(config.publication, "manual-owner-approval-required");
  assert.ok(Array.isArray(config.allowedLicenseExpressions));
  assert.ok(config.allowedLicenseExpressions.length > 0);
  assert.equal(new Set(config.allowedLicenseExpressions).size, config.allowedLicenseExpressions.length);
  return config;
}

export function artifactStem(config) {
  return `${config.archivePrefix}-v${config.version}-${config.platform}`;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function parseCargoPackageVersion(source) {
  const packageSection = source.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  assert.ok(packageSection, "CLI Cargo.toml must contain a [package] section");
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.ok(version, "CLI Cargo.toml must declare a package version");
  return version;
}

export function assertSafeOutputDirectory(allowedRoot, output) {
  const expectedOutput = resolve(allowedRoot, "dist");
  assert.equal(output, expectedOutput, "package output must be exactly apps/cli/dist");
  assert.equal(
    realpathSync(dirname(output)),
    realpathSync(allowedRoot),
    "package output parent must canonically be the CLI workspace"
  );
  if (existsSync(output)) {
    const outputStat = lstatSync(output);
    assert.equal(outputStat.isSymbolicLink(), false, "apps/cli/dist must not be a symbolic link");
    assert.equal(outputStat.isDirectory(), true, "apps/cli/dist must be a directory when it exists");
  }
}

export function signingArguments(identity, bundle, entitlements = null) {
  return identity === "-"
    ? ["--force", "--sign", "-", "--timestamp=none", bundle]
    : ["--force", "--sign", identity, "--options", "runtime", "--timestamp", "--entitlements", entitlements, bundle];
}

export function validateProtectedEntitlements(entitlements, config = readReleaseConfig()) {
  assert.ok(entitlements && typeof entitlements === "object", "signed entitlements are required");
  assert.equal(
    entitlements["com.apple.application-identifier"],
    config.keychainAccessGroup,
    "application identifier must match the CLI Keychain access group"
  );
  assert.equal(
    entitlements["com.apple.developer.team-identifier"],
    config.teamIdentifier,
    "signed Team ID must match the CLI release team"
  );
  assert.deepEqual(
    entitlements["keychain-access-groups"],
    [config.keychainAccessGroup],
    "the release may access only its stable CLI Keychain group"
  );
  assert.notEqual(entitlements["get-task-allow"], true, "distribution credentials must not be debuggable");
}

export function assertNoProtectedEntitlements(entitlements = {}, config = readReleaseConfig()) {
  assert.notEqual(entitlements["com.apple.application-identifier"], config.keychainAccessGroup);
  assert.notEqual(entitlements["com.apple.developer.team-identifier"], config.teamIdentifier);
  assert.equal(
    Array.isArray(entitlements["keychain-access-groups"]) &&
      entitlements["keychain-access-groups"].includes(config.keychainAccessGroup),
    false,
    "ad-hoc inspection builds must not claim the protected CLI Keychain group"
  );
}

export function validateProvisioningProfile(profile, config = readReleaseConfig(), now = new Date()) {
  assert.ok(profile && typeof profile === "object", "a decoded provisioning profile is required");
  assert.ok(profile.UUID && profile.Name, "the provisioning profile must have a name and UUID");
  assert.deepEqual(profile.TeamIdentifier, [config.teamIdentifier], "profile Team ID must match the release team");
  assert.ok(
    Array.isArray(profile.ApplicationIdentifierPrefix) &&
      profile.ApplicationIdentifierPrefix.some(
        (prefix) => prefix === config.teamIdentifier || prefix === `${config.teamIdentifier}.`
      ),
    "profile application identifier prefix must match the release team"
  );
  assert.equal(profile.ProvisionsAllDevices, true, "a Developer ID distribution profile is required");
  assert.equal(profile.ProvisionedDevices, undefined, "development profiles are not valid for public releases");
  assert.ok(new Date(profile.ExpirationDate) > now, "the provisioning profile is expired");
  validateProtectedEntitlements(profile.Entitlements, config);
  return {
    uuid: profile.UUID,
    name: profile.Name,
    expiration: new Date(profile.ExpirationDate).toISOString(),
    teamIdentifier: config.teamIdentifier,
    applicationIdentifier: config.keychainAccessGroup,
    keychainAccessGroups: [config.keychainAccessGroup]
  };
}

export function decodePlistBuffer(buffer, label = "property list") {
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", "--", "-"], {
    input: buffer,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} is not a valid property list`);
  return JSON.parse(result.stdout.toString("utf8"));
}

export function inspectProvisioningProfile(path, config = readReleaseConfig()) {
  assert.ok(path, "Developer ID mode requires --provisioning-profile or MULTAIPLAYER_CLI_PROVISIONING_PROFILE");
  assert.equal(existsSync(path), true, "the provisioning profile does not exist");
  const result = spawnSync("security", ["cms", "-D", "-i", path], {
    encoding: null,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "the provisioning profile could not be decoded by macOS");
  const decoded = decodePlistBuffer(result.stdout, "provisioning profile");
  return { decoded, metadata: validateProvisioningProfile(decoded, config) };
}

export function inspectSignedEntitlements(bundle) {
  const result = spawnSync("codesign", ["-d", "--entitlements", "-", "--xml", bundle], {
    encoding: null,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "codesign entitlement inspection failed");
  const combined = Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]);
  const start = combined.indexOf(Buffer.from("<?xml"));
  assert.notEqual(start, -1, "codesign did not return an entitlement property list");
  const closingTag = Buffer.from("</plist>");
  const end = combined.indexOf(closingTag, start);
  assert.notEqual(end, -1, "codesign returned an incomplete entitlement property list");
  return decodePlistBuffer(combined.subarray(start, end + closingTag.length), "signed entitlements");
}

export function inspectSigningCertificate(bundle) {
  const temporary = mkdtempSync(resolve(tmpdir(), "multaiplayer-cli-signing-certificate-"));
  try {
    const prefix = resolve(temporary, "certificate-");
    const result = spawnSync("codesign", ["-d", `--extract-certificates=${prefix}`, bundle], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "the signing certificate chain could not be extracted");
    const leafPath = `${prefix}0`;
    assert.equal(existsSync(leafPath), true, "the Developer ID signature has no leaf signing certificate");
    const der = readFileSync(leafPath);
    assert.ok(der.length > 0, "the Developer ID leaf signing certificate is empty");
    return {
      sha256: createHash("sha256").update(der).digest("hex"),
      der
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function bindProvisioningProfileToSigningCertificate(profile, signingCertificate) {
  assert.ok(Array.isArray(profile?.DeveloperCertificates), "profile has no DeveloperCertificates allowlist");
  assert.match(signingCertificate?.sha256 || "", /^[0-9a-f]{64}$/);
  const certificateHashes = profile.DeveloperCertificates.map((certificate, index) => {
    assert.equal(typeof certificate, "string", `profile DeveloperCertificates[${index}] is not certificate data`);
    assert.match(
      certificate,
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      `profile DeveloperCertificates[${index}] is not canonical base64`
    );
    const der = Buffer.from(certificate, "base64");
    assert.ok(der.length > 0, `profile DeveloperCertificates[${index}] is empty`);
    return createHash("sha256").update(der).digest("hex");
  });
  assert.equal(
    certificateHashes.filter((hash) => hash === signingCertificate.sha256).length,
    1,
    "the exact leaf signing certificate must appear once in the provisioning profile"
  );
  return signingCertificate.sha256;
}

export function validateSignatureMetadata(signature) {
  assert.ok(signature && typeof signature === "object", "signature metadata is required");
  if (signature.mode === "adhoc-local-verification") {
    assert.equal(signature.identityKind, "adhoc");
    assert.equal(signature.secureTimestamp, false);
    assert.equal(signature.authority, null);
    assert.equal(signature.teamIdentifier, null);
    assert.equal(signature.timestamp, null);
    assert.equal(signature.hardenedRuntime, false);
    return;
  }
  assert.equal(signature.mode, "developer-id-distribution");
  assert.equal(signature.identityKind, "developer-id-application");
  assert.equal(signature.secureTimestamp, true);
  assert.match(signature.authority, /^Developer ID Application:/);
  assert.match(signature.teamIdentifier, /^[A-Z0-9]{10}$/);
  assert.ok(typeof signature.timestamp === "string" && signature.timestamp.length > 0);
  assert.equal(signature.hardenedRuntime, true);
}

export function parseCodeSignatureDetails(detail) {
  const isAdhoc = /^Signature=adhoc$/m.test(detail);
  if (isAdhoc) {
    return {
      mode: "adhoc-local-verification",
      identityKind: "adhoc",
      secureTimestamp: false,
      authority: null,
      teamIdentifier: null,
      timestamp: null,
      hardenedRuntime: false
    };
  }
  const authority = detail.match(/^Authority=(.+)$/m)?.[1] || null;
  const rawTeamIdentifier = detail.match(/^TeamIdentifier=(.+)$/m)?.[1] || null;
  const timestamp = detail.match(/^Timestamp=(.+)$/m)?.[1] || null;
  const hardenedRuntime = /^Runtime Version=.+$/m.test(detail);
  return {
    mode: "developer-id-distribution",
    identityKind: "developer-id-application",
    secureTimestamp: timestamp !== null,
    authority,
    teamIdentifier: rawTeamIdentifier === "not set" ? null : rawTeamIdentifier,
    timestamp,
    hardenedRuntime
  };
}

export function inspectCodeSignature(binary) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", binary], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "codesign signature inspection failed");
  return parseCodeSignatureDetails(`${result.stdout}${result.stderr}`);
}

export function assertSignatureMetadataMatchesObserved(observed, claimed) {
  validateSignatureMetadata(observed);
  validateSignatureMetadata(claimed);
  assert.deepEqual(claimed, observed, "claimed signature metadata must exactly match the extracted binary");
}

export function validateDependencyLicenses(packages, allowedExpressions) {
  const missingExpression = packages.filter((pkg) => !pkg.license);
  assert.deepEqual(
    missingExpression.map((pkg) => `${pkg.name}@${pkg.version}`),
    [],
    "every dependency must declare an explicitly reviewed SPDX license expression"
  );
  const allowed = new Set(allowedExpressions);
  const unreviewed = packages.filter((pkg) => pkg.license && !allowed.has(pkg.license));
  assert.deepEqual(
    unreviewed.map((pkg) => `${pkg.name}@${pkg.version}:${pkg.license}`),
    [],
    "every dependency license expression must be explicitly reviewed"
  );
}

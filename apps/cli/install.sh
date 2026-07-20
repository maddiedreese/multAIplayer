#!/bin/sh

set -eu

version="0.1.0-alpha.12"
repository="maddiedreese/multAIplayer"
tag="cli-v${version}"
stem="multAIplayer-cli-v${version}-darwin-arm64"
release_base="https://github.com/${repository}/releases/download/${tag}"
bundle_name="multAIplayer.app"
bundle_id="com.multaiplayer.cli"
team_id="AXP55K75AX"
keychain_group="AXP55K75AX.com.multaiplayer.cli"
profile_keychain_group="AXP55K75AX.*"
data_dir="${MULTAIPLAYER_CLI_DATA_DIR:-${HOME}/Library/Application Support/multAIplayer/cli}"
bin_dir="${MULTAIPLAYER_CLI_BIN_DIR:-${HOME}/.local/bin}"

fail() {
  printf 'multAIplayer install: %s\n' "$1" >&2
  exit 1
}

timestamp_epoch() {
  timestamp_zone="$1"
  timestamp_value="$(printf '%s' "$2" | sed 's/[  ]/ /g')"
  if [ "$timestamp_zone" = "local" ]; then
    LC_ALL=C date -j -f '%b %e, %Y at %I:%M:%S %p' "$timestamp_value" '+%s' 2>/dev/null
  else
    TZ="$timestamp_zone" LC_ALL=C date -j -f '%b %e, %Y at %I:%M:%S %p' "$timestamp_value" '+%s' 2>/dev/null
  fi
}

[ "$(uname -s)" = "Darwin" ] || fail "Apple-silicon macOS is required."
[ "$(uname -m)" = "arm64" ] || fail "Apple silicon is required."

for command in curl shasum tar codesign plutil security mkdir mv ln mktemp sed head cp sort date awk base64; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: ${command}"
done
[ -x /usr/libexec/PlistBuddy ] || fail "required macOS property-list verifier is unavailable."

temporary="$(mktemp -d "${TMPDIR:-/tmp}/multaiplayer-cli-install.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

archive="${stem}.tar.gz"
manifest="${stem}.manifest.json"
sums="SHA256SUMS.txt"

for asset in "$archive" "$manifest" "$sums"; do
  curl --fail --location --silent --show-error --retry 3 \
    --output "${temporary}/${asset}" "${release_base}/${asset}"
done

(
  cd "$temporary"
  shasum -a 256 -c "$sums"
)

entries="$(tar -tzf "${temporary}/${archive}")"
case "${entries}" in
  *'../'*|/*) fail "the release archive contains an unsafe path." ;;
esac
printf '%s\n' "$entries" | while IFS= read -r entry; do
  case "$entry" in
    "${stem}"/*|"${stem}/") ;;
    *) fail "the release archive escapes its versioned package directory." ;;
  esac
done

expected_entries="$(
  printf '%s\n' \
    "${stem}/" \
    "${stem}/BUILD-METADATA.json" \
    "${stem}/INSTALL.md" \
    "${stem}/LICENSE" \
    "${stem}/THIRD_PARTY_NOTICES.md" \
    "${stem}/${bundle_name}/" \
    "${stem}/${bundle_name}/Contents/" \
    "${stem}/${bundle_name}/Contents/Info.plist" \
    "${stem}/${bundle_name}/Contents/MacOS/" \
    "${stem}/${bundle_name}/Contents/MacOS/multAIplayer" \
    "${stem}/${bundle_name}/Contents/_CodeSignature/" \
    "${stem}/${bundle_name}/Contents/_CodeSignature/CodeResources" \
    "${stem}/${bundle_name}/Contents/embedded.provisionprofile" | sort
)"
[ "$(printf '%s\n' "$entries" | sort)" = "$expected_entries" ] || fail "the release archive contains unexpected or missing entries."

typed_entries="$(tar -tvzf "${temporary}/${archive}" | awk '{ print substr($1, 1, 1) " " $NF }' | sort)"
expected_typed_entries="$(
  printf '%s\n' \
    "d ${stem}/" \
    "- ${stem}/BUILD-METADATA.json" \
    "- ${stem}/INSTALL.md" \
    "- ${stem}/LICENSE" \
    "- ${stem}/THIRD_PARTY_NOTICES.md" \
    "d ${stem}/${bundle_name}/" \
    "d ${stem}/${bundle_name}/Contents/" \
    "- ${stem}/${bundle_name}/Contents/Info.plist" \
    "d ${stem}/${bundle_name}/Contents/MacOS/" \
    "- ${stem}/${bundle_name}/Contents/MacOS/multAIplayer" \
    "d ${stem}/${bundle_name}/Contents/_CodeSignature/" \
    "- ${stem}/${bundle_name}/Contents/_CodeSignature/CodeResources" \
    "- ${stem}/${bundle_name}/Contents/embedded.provisionprofile" | sort
)"
[ "$typed_entries" = "$expected_typed_entries" ] || fail "the release archive contains a link, device, or unexpected entry type."

tar -xzf "${temporary}/${archive}" -C "$temporary"
bundle="${temporary}/${stem}/${bundle_name}"
binary="${bundle}/Contents/MacOS/multAIplayer"
profile="${bundle}/Contents/embedded.provisionprofile"
[ -d "$bundle" ] || fail "the verified archive does not contain ${bundle_name}."
[ -f "$binary" ] || fail "the verified app bundle does not contain multAIplayer."
[ -f "$profile" ] || fail "the release has no embedded Developer ID provisioning profile."

signature_mode="$(plutil -extract signature.mode raw -o - "${temporary}/${manifest}")"
[ "$signature_mode" = "developer-id-distribution" ] || fail "the release is not a Developer ID distribution build."
claimed_bundle_id="$(plutil -extract bundleIdentifier raw -o - "${temporary}/${manifest}")"
claimed_version="$(plutil -extract version raw -o - "${temporary}/${manifest}")"
claimed_binary_sha256="$(plutil -extract binarySha256 raw -o - "${temporary}/${manifest}")"
claimed_authority="$(plutil -extract signature.authority raw -o - "${temporary}/${manifest}")"
claimed_team="$(plutil -extract signature.teamIdentifier raw -o - "${temporary}/${manifest}")"
claimed_timestamp="$(plutil -extract signature.timestamp raw -o - "${temporary}/${manifest}")"
claimed_profile_uuid="$(plutil -extract provisioningProfile.uuid raw -o - "${temporary}/${manifest}")"

[ "$claimed_bundle_id" = "$bundle_id" ] || fail "the release manifest has the wrong CLI bundle identifier."
[ "$claimed_version" = "$version" ] || fail "the release manifest version does not match this installer."
[ "$claimed_team" = "$team_id" ] || fail "the release manifest has the wrong CLI Team ID."
[ "$(shasum -a 256 "$binary" | awk '{ print $1 }')" = "$claimed_binary_sha256" ] || fail "the executable checksum does not match the release manifest."

codesign --verify --strict --verbose=2 "$bundle"
signature_details="$(LC_ALL=C codesign -d --verbose=4 "$bundle" 2>&1)"
observed_authority="$(printf '%s\n' "$signature_details" | sed -n 's/^Authority=//p' | head -n 1)"
observed_team="$(printf '%s\n' "$signature_details" | sed -n 's/^TeamIdentifier=//p' | head -n 1)"
observed_timestamp="$(printf '%s\n' "$signature_details" | sed -n 's/^Timestamp=//p' | head -n 1)"
observed_runtime="$(printf '%s\n' "$signature_details" | sed -n 's/^Runtime Version=//p' | head -n 1)"

[ "$observed_authority" = "$claimed_authority" ] || fail "the Developer ID authority does not match the release manifest."
[ "$observed_team" = "$claimed_team" ] || fail "the Developer ID team does not match the release manifest."
# GitHub's macOS release runner records codesign output in UTC, while codesign
# renders the same secure timestamp in the installing Mac's configured zone.
claimed_timestamp_epoch="$(timestamp_epoch UTC "$claimed_timestamp")" || fail "the release manifest has an invalid secure timestamp."
observed_timestamp_epoch="$(timestamp_epoch local "$observed_timestamp")" || fail "the release signature has an invalid secure timestamp."
[ "$observed_timestamp_epoch" = "$claimed_timestamp_epoch" ] || fail "the secure timestamp does not match the release manifest."
[ -n "$observed_runtime" ] || fail "the release signature does not enable hardened runtime."
case "$observed_authority" in
  "Developer ID Application:"*) ;;
  *) fail "the app bundle is not signed with a Developer ID Application identity." ;;
esac

info_bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "${bundle}/Contents/Info.plist")"
info_release_version="$(plutil -extract MultAIplayerCLIVersion raw -o - "${bundle}/Contents/Info.plist")"
[ "$info_bundle_id" = "$bundle_id" ] || fail "the signed app bundle has the wrong identifier."
[ "$info_release_version" = "$version" ] || fail "the signed app bundle has the wrong CLI release version."

codesign -d --entitlements - --xml "$bundle" >"${temporary}/signed-entitlements.plist" 2>/dev/null
signed_application_id="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.application-identifier' "${temporary}/signed-entitlements.plist")"
signed_team="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "${temporary}/signed-entitlements.plist")"
signed_keychain_group="$(/usr/libexec/PlistBuddy -c 'Print :keychain-access-groups:0' "${temporary}/signed-entitlements.plist")"
[ "$signed_application_id" = "$keychain_group" ] || fail "the signed application identifier is not the protected CLI identity."
[ "$signed_team" = "$team_id" ] || fail "the signed entitlement Team ID is incorrect."
[ "$signed_keychain_group" = "$keychain_group" ] || fail "the signed Keychain access group is incorrect."
if /usr/libexec/PlistBuddy -c 'Print :keychain-access-groups:1' "${temporary}/signed-entitlements.plist" >/dev/null 2>&1; then
  fail "the release signature authorizes an unexpected additional Keychain group."
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :get-task-allow' "${temporary}/signed-entitlements.plist" 2>/dev/null || true)" = "true" ]; then
  fail "the release signature allows debugging of protected credentials."
fi

security cms -D -i "$profile" >"${temporary}/profile.plist" 2>/dev/null
profile_uuid="$(plutil -extract UUID raw -o - "${temporary}/profile.plist")"
profile_application_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "${temporary}/profile.plist")"
profile_team="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.developer.team-identifier' "${temporary}/profile.plist")"
observed_profile_keychain_group="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:keychain-access-groups:0' "${temporary}/profile.plist")"
profile_team_identifier="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "${temporary}/profile.plist")"
profile_prefix="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationIdentifierPrefix:0' "${temporary}/profile.plist")"
profile_all_devices="$(/usr/libexec/PlistBuddy -c 'Print :ProvisionsAllDevices' "${temporary}/profile.plist")"
profile_expiration="$(plutil -extract ExpirationDate raw -o - "${temporary}/profile.plist")"
[ "$profile_uuid" = "$claimed_profile_uuid" ] || fail "the embedded profile does not match the release manifest."
[ "$profile_application_id" = "$keychain_group" ] || fail "the profile does not authorize the CLI application identifier."
[ "$profile_team" = "$team_id" ] || fail "the profile Team ID is incorrect."
[ "$observed_profile_keychain_group" = "$profile_keychain_group" ] || fail "the profile does not contain Apple's expected team-scoped Keychain authorization."
[ "$profile_team_identifier" = "$team_id" ] || fail "the profile identity does not belong to the CLI release team."
case "$profile_prefix" in
  "$team_id"|"${team_id}.") ;;
  *) fail "the profile application prefix is incorrect." ;;
esac
[ "$profile_all_devices" = "true" ] || fail "the embedded profile is not a Developer ID distribution profile."
if /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "${temporary}/profile.plist" >/dev/null 2>&1; then
  fail "development provisioning profiles are not valid public releases."
fi
if /usr/libexec/PlistBuddy -c 'Print :Entitlements:keychain-access-groups:1' "${temporary}/profile.plist" >/dev/null 2>&1; then
  fail "the profile authorizes an unexpected additional Keychain group."
fi
profile_first="$(printf '%s\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$profile_expiration" | sort | head -n 1)"
[ "$profile_first" != "$profile_expiration" ] || fail "the embedded provisioning profile is expired."

codesign -d "--extract-certificates=${temporary}/signer-certificate-" "$bundle" >/dev/null 2>&1
signer_certificate="${temporary}/signer-certificate-0"
[ -s "$signer_certificate" ] || fail "the Developer ID signature has no leaf signing certificate."
signer_certificate_sha256="$(shasum -a 256 "$signer_certificate" | awk '{ print $1 }')"
claimed_signer_sha256="$(plutil -extract provisioningProfile.signingCertificateSha256 raw -o - "${temporary}/${manifest}")"
[ "$signer_certificate_sha256" = "$claimed_signer_sha256" ] || fail "the observed signer does not match the release manifest."
profile_signer_matches=0
profile_certificate_index=0
while profile_certificate_data="$(plutil -extract "DeveloperCertificates.${profile_certificate_index}" raw -o - "${temporary}/profile.plist" 2>/dev/null)"; do
  printf '%s' "$profile_certificate_data" | base64 -D >"${temporary}/profile-certificate-${profile_certificate_index}.der"
  profile_certificate_sha256="$(shasum -a 256 "${temporary}/profile-certificate-${profile_certificate_index}.der" | awk '{ print $1 }')"
  if [ "$profile_certificate_sha256" = "$signer_certificate_sha256" ]; then
    profile_signer_matches=$((profile_signer_matches + 1))
  fi
  profile_certificate_index=$((profile_certificate_index + 1))
done
[ "$profile_certificate_index" -gt 0 ] || fail "the profile has no DeveloperCertificates allowlist."
[ "$profile_signer_matches" -eq 1 ] || fail "the exact leaf signing certificate must appear once in the provisioning profile."

if ! notarization="$(codesign -vvvv -R='notarized' --check-notarization "$bundle" 2>&1)"; then
  printf '%s\n' "$notarization" >&2
  fail "Apple did not identify a notarized Developer ID release."
fi

expected_version_output="multAIplayer ${version}"
[ "$($binary --version)" = "$expected_version_output" ] || fail "the executable version does not match this installer."

versions_dir="${data_dir}/versions"
version_dir="${versions_dir}/${version}"
staging_dir="${versions_dir}/.${version}.installing.$$"
destination="${version_dir}/${bundle_name}"
command_path="${bin_dir}/multAIplayer"
mkdir -p "$versions_dir" "$bin_dir"
[ ! -e "$version_dir" ] || fail "version ${version} is already installed; remove it explicitly before reinstalling."
[ ! -d "$command_path" ] || fail "${command_path} is a directory and cannot be replaced with the CLI link."
mkdir -p "$staging_dir"
cp -R "$bundle" "${staging_dir}/${bundle_name}"
mv "$staging_dir" "$version_dir"
ln -sfn "${destination}/Contents/MacOS/multAIplayer" "$command_path"

"$command_path" --version
printf 'Installed multAIplayer %s\n' "$version"
printf 'Command: %s\n' "$command_path"
case ":${PATH}:" in
  *":${bin_dir}:"*) ;;
  *) printf 'Add %s to PATH to run: multAIplayer\n' "$bin_dir" ;;
esac

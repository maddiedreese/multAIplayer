#!/bin/sh

set -eu

version="0.1.0-alpha.1"
repository="maddiedreese/multAIplayer"
tag="cli-v${version}"
stem="multAIplayer-cli-v${version}-darwin-arm64"
release_base="https://github.com/${repository}/releases/download/${tag}"
install_dir="${MULTAIPLAYER_CLI_INSTALL_DIR:-/usr/local/bin}"

fail() {
  printf 'multAIplayer install: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "Apple-silicon macOS is required."
[ "$(uname -m)" = "arm64" ] || fail "Apple silicon is required."

for command in curl shasum tar codesign plutil install mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: ${command}"
done

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

tar -xzf "${temporary}/${archive}" -C "$temporary"
binary="${temporary}/${stem}/multAIplayer"
[ -f "$binary" ] || fail "the verified archive does not contain multAIplayer."

signature_mode="$(plutil -extract signature.mode raw -o - "${temporary}/${manifest}")"
[ "$signature_mode" = "developer-id-distribution" ] || fail "the release is not a Developer ID distribution build."

claimed_authority="$(plutil -extract signature.authority raw -o - "${temporary}/${manifest}")"
claimed_team="$(plutil -extract signature.teamIdentifier raw -o - "${temporary}/${manifest}")"
claimed_timestamp="$(plutil -extract signature.timestamp raw -o - "${temporary}/${manifest}")"

codesign --verify --strict --verbose=2 "$binary"
signature_details="$(codesign -d --verbose=4 "$binary" 2>&1)"
observed_authority="$(printf '%s\n' "$signature_details" | sed -n 's/^Authority=//p' | head -n 1)"
observed_team="$(printf '%s\n' "$signature_details" | sed -n 's/^TeamIdentifier=//p' | head -n 1)"
observed_timestamp="$(printf '%s\n' "$signature_details" | sed -n 's/^Timestamp=//p' | head -n 1)"

[ "$observed_authority" = "$claimed_authority" ] || fail "the Developer ID authority does not match the release manifest."
[ "$observed_team" = "$claimed_team" ] || fail "the Developer ID team does not match the release manifest."
[ "$observed_timestamp" = "$claimed_timestamp" ] || fail "the secure timestamp does not match the release manifest."
case "$observed_authority" in
  "Developer ID Application:"*) ;;
  *) fail "the binary is not signed with a Developer ID Application identity." ;;
esac

if ! notarization="$(codesign -vvvv -R='notarized' --check-notarization "$binary" 2>&1)"; then
  printf '%s\n' "$notarization" >&2
  fail "Apple did not identify a notarized Developer ID release."
fi

destination="${install_dir}/multAIplayer"
if [ -d "$install_dir" ] && [ -w "$install_dir" ]; then
  install -m 0755 "$binary" "$destination"
else
  command -v sudo >/dev/null 2>&1 || fail "${install_dir} is not writable and sudo is unavailable."
  sudo mkdir -p "$install_dir"
  sudo install -m 0755 "$binary" "$destination"
fi

"$destination" --version
printf 'Installed multAIplayer at %s\n' "$destination"

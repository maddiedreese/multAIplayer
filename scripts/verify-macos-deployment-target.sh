#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?usage: verify-macos-deployment-target.sh /path/to/app}"
expected_version="11.0"
main_executable="$app_path/Contents/MacOS/multAIplayer"

declared_version="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app_path/Contents/Info.plist")"
if [[ "$declared_version" != "$expected_version" ]]; then
  echo "LSMinimumSystemVersion must be $expected_version; found: $declared_version" >&2
  exit 1
fi

archs="$(lipo -archs "$main_executable")"
if [[ "$archs" != "arm64" ]]; then
  echo "Main executable must contain only arm64; found: $archs" >&2
  exit 1
fi

checked=0
while IFS= read -r -d '' candidate; do
  if ! file -b "$candidate" | grep -q 'Mach-O'; then
    continue
  fi
  checked=$((checked + 1))
  if ! lipo -verify_arch arm64 "$candidate"; then
    echo "Bundled Mach-O file does not contain arm64: $candidate" >&2
    exit 1
  fi
  versions="$(vtool -show-build "$candidate" | awk '$1 == "minos" { print $2 }')"
  if [[ -z "$versions" ]]; then
    echo "Mach-O file has no readable minimum OS load command: $candidate" >&2
    exit 1
  fi
  while IFS= read -r version; do
    major="${version%%.*}"
    remainder="${version#*.}"
    minor="${remainder%%.*}"
    if (( major > 11 || (major == 11 && minor > 0) )); then
      echo "Mach-O file requires macOS $version, above the supported 11.0 floor: $candidate" >&2
      exit 1
    fi
  done <<< "$versions"
done < <(find "$app_path/Contents" -type f -print0)

if (( checked == 0 )); then
  echo "No Mach-O files found in app bundle: $app_path" >&2
  exit 1
fi

main_versions="$(vtool -show-build "$main_executable" | awk '$1 == "minos" { print $2 }')"
if ! grep -qx "$expected_version" <<< "$main_versions"; then
  echo "Main executable must encode macOS $expected_version in its build-version load command; found: $main_versions" >&2
  exit 1
fi

echo "Verified $checked bundled Mach-O file(s) contain arm64 and require no later than macOS 11.0."

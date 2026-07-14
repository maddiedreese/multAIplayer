#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 || $1 != "run" ]]; then
  echo "cargo-build-only expects Tauri to invoke 'run'" >&2
  exit 64
fi

shift
args=(build)
while [[ $# -gt 0 ]]; do
  # Tauri terminates Cargo arguments with `--` before optional app arguments.
  # This journey passes no app arguments, and `cargo build` does not accept the
  # otherwise-empty separator.
  if [[ $1 == "--" && $# -eq 1 ]]; then
    break
  fi
  args+=("$1")
  shift
done

exec cargo "${args[@]}"

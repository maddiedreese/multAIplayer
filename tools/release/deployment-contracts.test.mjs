import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepositoryFile = (path) => readFileSync(path, "utf8");

test("Railway watches every relay image build and runtime dependency", () => {
  const railway = JSON.parse(readRepositoryFile("railway.json"));
  assert.equal(railway.build?.builder, "DOCKERFILE");
  assert.equal(railway.build?.dockerfilePath, "apps/relay/Dockerfile");

  const watchPatterns = new Set(railway.build?.watchPatterns);
  const requiredPatterns = [
    "/apps/relay/**",
    "/apps/desktop/src-tauri/Cargo.lock",
    "/apps/desktop/src-tauri/Cargo.toml",
    "/apps/desktop/src-tauri/crates/mls-core/**",
    "/packages/**",
    "/tools/release/relay-runtime-dependency-closure.mjs",
    "/.dockerignore",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.base.json",
    "/railway.json"
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(watchPatterns.has(pattern), `Railway must rebuild when ${pattern} changes`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("MLS mutation testing stays pinned, focused, bounded, and non-PR", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const start = workflow.indexOf("  mls-invite-authenticator-mutation:");
  const end = workflow.indexOf("\n  mls-deserialization-fuzz:", start);
  assert.notEqual(start, -1, "missing MLS mutation job");
  assert.notEqual(end, -1, "MLS mutation job must precede the fuzz job");
  const job = workflow.slice(start, end);

  assert.match(job, /cargo install cargo-mutants --version 27\.1\.0 --locked/);
  assert.match(job, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(job, /--package mls-core/);
  assert.match(job, /--file crates\/mls-core\/src\/invite_capability\.rs/);
  assert.match(
    job,
    /--re 'invite_capability\.rs\.\*\(encode_capability_binding\|mac_binding\|verify_request_binding\|mac_response_binding\|verify_response_binding\|authenticate\|verify\|derive_mac_key\|validate\)'/
  );
  assert.match(job, /--in-place/);
  assert.match(job, /--no-shuffle/);
  assert.match(job, /--jobs 2/);
  assert.match(job, /--timeout 120/);
  assert.match(job, /if: always\(\)/);
  assert.match(job, /path: apps\/desktop\/src-tauri\/mutants\.out/);
  assert.match(job, /if-no-files-found: error/);
  assert.doesNotMatch(job, /pull_request/);
});

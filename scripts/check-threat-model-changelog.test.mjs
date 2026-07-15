import assert from "node:assert/strict";
import test from "node:test";
import {
  changedPaths,
  hasDatedHistoryAddition,
  isSecurityClaimPath,
  threatModelChangelogViolation
} from "./check-threat-model-changelog.mjs";

test("classifies security boundary and claim paths without inspecting source text", () => {
  assert.equal(isSecurityClaimPath("apps/relay/src/auth/session.ts"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src-tauri/src/room_archive.rs"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src-tauri/src/project.rs"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src/application/files/fileActions.ts"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src/application/terminal/terminalActions.ts"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src/lib/handoff/hostHandoffMachine.ts"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src/lib/codex/codexTurn.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/authz.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/config.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/relay-app.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/limits.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/state.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/http/device-auth.ts"), true);
  assert.equal(isSecurityClaimPath("apps/relay/src/http/room-host-route.ts"), true);
  assert.equal(isSecurityClaimPath("packages/protocol/src/relay-messages.ts"), true);
  assert.equal(isSecurityClaimPath("docs/external-review-packet.md"), true);
  assert.equal(isSecurityClaimPath("README.md"), true);
  assert.equal(isSecurityClaimPath("apps/desktop/src/components/RoomHeader.tsx"), false);
});

test("requires the public changelog when a protected path changes", () => {
  assert.match(
    threatModelChangelogViolation(["README.md", "apps/relay/src/ws/fanout.ts"]),
    /docs\/threat-model\.md#history/
  );
  assert.match(
    threatModelChangelogViolation(["apps/relay/src/ws/fanout.ts", "docs/threat-model.md"], "+typo only\n"),
    /add a dated entry/
  );
  assert.equal(
    threatModelChangelogViolation(
      ["apps/relay/src/ws/fanout.ts", "docs/threat-model.md"],
      "@@ -1,0 +2 @@\n+### 2026-07-14\n"
    ),
    null
  );
  assert.equal(hasDatedHistoryAddition("+### 2026-07-14\n"), true);
});

test("does not tax ordinary product and non-claim documentation changes", () => {
  assert.equal(
    threatModelChangelogViolation(["docs/using-the-app.md", "apps/desktop/src/components/RoomHeader.tsx"]),
    null
  );
});

test("diffs from the merge base and disables rename collapsing", () => {
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    return args[0] === "merge-base" ? "base-commit\n" : "apps/relay/src/authz.ts\0moved/authz.ts\0";
  };
  assert.deepEqual(changedPaths("origin/main", "HEAD", run), ["apps/relay/src/authz.ts", "moved/authz.ts", ""]);
  assert.deepEqual(calls, [
    ["merge-base", "origin/main", "HEAD"],
    ["diff", "--no-renames", "--name-only", "-z", "base-commit", "HEAD"]
  ]);
});

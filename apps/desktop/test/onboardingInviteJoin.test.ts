import assert from "node:assert/strict";
import test from "node:test";
import { RelayHttpError } from "../src/lib/core/httpResponse";
import { createOnboardingInviteJoinAdapter } from "../src/lib/onboarding/onboardingInviteJoin";
import { InviteJoinError, type InviteJoinErrorCode } from "../src/lib/invite/inviteJoinError";

const manualInvite = "https://app.example.test/#invite=invite_123&multaiplayerJoin=protected-fragment&approval=request";

test("manual input delegates to the real MLS join port and reports only pending host approval", async () => {
  const calls: Array<{ encoded: string; inviteId?: string | null }> = [];
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async (encoded, inviteId) => {
      calls.push({ encoded, inviteId });
    }
  });

  const outcome = await adapter.joinManualInput(manualInvite);
  assert.deepEqual(calls, [{ encoded: "protected-fragment", inviteId: "invite_123" }]);
  assert.deepEqual(outcome, {
    status: "approval_pending",
    message: "Access requested. The active host must verify and approve this device before the room unlocks.",
    blocking: true,
    retryable: false
  });
  assert.doesNotMatch(JSON.stringify(outcome), /protected-fragment|invite_123/);
});

test("native protected payload delegates without reconstructing or rendering a URL", async () => {
  const calls: Array<{ encoded: string; inviteId?: string | null }> = [];
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async (encoded, inviteId) => calls.push({ encoded, inviteId })
  });
  const outcome = await adapter.joinProtectedPayload("protected-fragment", "invite_123");
  assert.deepEqual(calls, [{ encoded: "protected-fragment", inviteId: "invite_123" }]);
  assert.equal(outcome.status, "approval_pending");
  assert.doesNotMatch(JSON.stringify(outcome), /protected-fragment|invite_123/);
});

test("URL invite fragments are scrubbed before the MLS request begins", async () => {
  const order: string[] = [];
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async () => {
      order.push("request");
    }
  });
  const outcome = await adapter.joinFromUrl(
    {
      pathname: "/app",
      search: "",
      hash: "#invite=invite_123&multaiplayerJoin=protected-fragment&approval=request"
    },
    (cleanupPath) => {
      assert.equal(cleanupPath, "/app");
      order.push("scrub");
    }
  );

  assert.deepEqual(order, ["scrub", "request"]);
  assert.equal(outcome.status, "approval_pending");
});

test("scrub failure fails closed without sending the bearer capability", async () => {
  let requested = false;
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async () => {
      requested = true;
    }
  });
  const outcome = await adapter.joinFromUrl(
    { pathname: "/", search: "", hash: "#invite=invite_123&multaiplayerJoin=protected-fragment" },
    () => {
      throw new Error("history unavailable");
    }
  );
  assert.equal(requested, false);
  assert.equal(outcome.status, "temporarily_unavailable");
});

test("obsolete and incomplete manual invites are rejected without entering MLS", async () => {
  let calls = 0;
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async () => {
      calls += 1;
    }
  });
  const legacy = await adapter.joinManualInput(
    "https://app.example.test/#invite=old&multaiplayerInvite=legacy-room-secret"
  );
  const incomplete = await adapter.joinManualInput("https://app.example.test/");
  assert.equal(legacy.status, "invalid_invite");
  assert.equal(incomplete.status, "invalid_invite");
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify([legacy, incomplete]), /legacy-room-secret/);
});

test("relay errors map to actionable fixed statuses without forwarding server details", async () => {
  const errors = [
    new RelayHttpError("token=server-secret", 401, "authentication_required"),
    new RelayHttpError("path=/private/project", 410, "invite_expired"),
    new RelayHttpError("bearer=hidden", 404, "invite_not_found"),
    new RelayHttpError("database host details", 503, null)
  ];
  const statuses = [];
  for (const error of errors) {
    const adapter = createOnboardingInviteJoinAdapter({
      requestNoSecretInviteAccess: async () => {
        throw error;
      }
    });
    statuses.push(await adapter.joinManualInput(manualInvite));
  }
  assert.deepEqual(
    statuses.map(({ status }) => status),
    ["sign_in_required", "expired_invite", "invalid_invite", "temporarily_unavailable"]
  );
  assert.doesNotMatch(JSON.stringify(statuses), /server-secret|private\/project|bearer=hidden|database host/);
});

test("host binding codes are fixed verification errors independent of prose", async () => {
  const codes: InviteJoinErrorCode[] = [
    "invite_metadata_mismatch",
    "active_host_mismatch",
    "host_hpke_key_mismatch",
    "key_package_hash_mismatch"
  ];
  for (const code of codes) {
    const adapter = createOnboardingInviteJoinAdapter({
      requestNoSecretInviteAccess: async () => {
        throw new InviteJoinError(code, `copy may change for ${code}`);
      }
    });
    assert.equal((await adapter.joinManualInput(manualInvite)).status, "verification_failed");
  }

  const arbitrary = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async () => {
      throw new Error("/Users/person/project token=secret");
    }
  });
  const result = await arbitrary.joinManualInput(manualInvite);
  assert.equal(result.status, "temporarily_unavailable");
  assert.equal(result.retryable, true);
  assert.doesNotMatch(result.message, /Users|token|secret/);
});

test("a URL without an invite remains a nonblocking no-op", async () => {
  const adapter = createOnboardingInviteJoinAdapter({
    requestNoSecretInviteAccess: async () => assert.fail("MLS request should not run")
  });
  const outcome = await adapter.joinFromUrl({ pathname: "/", search: "", hash: "" }, () =>
    assert.fail("URL should not be scrubbed")
  );
  assert.deepEqual(outcome, {
    status: "no_invite",
    message: "No invite was found in this link.",
    blocking: false,
    retryable: false
  });
});

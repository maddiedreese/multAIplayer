import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingInviteIfMissing,
  processPendingInviteRecoveryAttempt,
  runPendingInviteRecoveryLoop,
  type PendingInviteRecoveryResult
} from "../src/lib/invite/pendingInviteRecovery";
import type { PendingMlsInviteRequest } from "../src/lib/mls/mlsClient";
import { RelayHttpError } from "../src/lib/core/httpResponse";

const pending: PendingMlsInviteRequest = {
  inviteId: "invite-one",
  teamId: "team-core",
  roomId: "room-desktop",
  requestId: "request-one",
  requesterUserId: "github:guest",
  requesterDeviceId: "device-guest",
  keyPackageId: "key-package-one",
  keyPackageHash: `sha256:${"a".repeat(64)}`,
  expiresAt: "2030-01-02T00:00:00.000Z",
  sealedRequest: "opaque-directed-request"
};

const response = {
  responseBinding: { phase: "response" },
  responseMac: "opaque-response-mac",
  welcome: "opaque-welcome"
};

type Dependencies = Parameters<typeof processPendingInviteRecoveryAttempt>[1];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    loadResponse: async () => null,
    publishRequest: async () => undefined,
    acceptResponse: async () => ({ status: "approved" }),
    acknowledge: async () => undefined,
    clear: async () => undefined,
    completeAdmission: async () => undefined,
    ...overrides
  };
}

test("pending recovery idempotently republishes the exact durable request", async () => {
  const publications: Array<{ inviteId: string; request: unknown }> = [];
  const deps = dependencies({
    publishRequest: async (inviteId, request) => {
      publications.push({ inviteId, request });
    }
  });

  assert.equal(await processPendingInviteRecoveryAttempt(pending, deps), "pending");
  assert.equal(await processPendingInviteRecoveryAttempt(pending, deps), "pending");
  const expected = {
    inviteId: pending.inviteId,
    request: {
      requestId: pending.requestId,
      requesterDeviceId: pending.requesterDeviceId,
      keyPackageId: pending.keyPackageId,
      keyPackageHash: pending.keyPackageHash,
      sealedRequest: pending.sealedRequest
    }
  };
  assert.deepEqual(publications, [expected, expected]);
});

test("approved recovery accepts before admission and durable clear", async () => {
  const events: string[] = [];
  const clear = async (requestId: string, roomId: string) => {
    assert.deepEqual([requestId, roomId], [pending.requestId, pending.roomId]);
    events.push("clear");
  };
  const result = await processPendingInviteRecoveryAttempt(
    pending,
    dependencies({
      loadResponse: async () => response,
      acceptResponse: async (requestId, binding, mac, welcome) => {
        events.push("accept");
        assert.equal(requestId, pending.requestId);
        assert.equal(binding, response.responseBinding);
        assert.equal(mac, response.responseMac);
        assert.equal(welcome, response.welcome);
        return { status: "approved" };
      },
      clear,
      completeAdmission: async (record) => {
        assert.equal(record, pending);
        events.push("admit");
        // The production admission dependency clears the pending native request
        // only after relay admission has completed successfully.
        await clear(record.requestId, record.roomId);
      }
    })
  );

  assert.equal(result, "approved");
  assert.deepEqual(events, ["accept", "admit", "clear"]);
});

test("denied recovery acknowledges the relay response before clearing native state", async () => {
  const events: string[] = [];
  const result = await processPendingInviteRecoveryAttempt(
    pending,
    dependencies({
      loadResponse: async () => ({ ...response, welcome: undefined }),
      acceptResponse: async () => {
        events.push("accept");
        return { status: "denied" };
      },
      acknowledge: async (inviteId, requestId, deviceId) => {
        events.push("ack");
        assert.deepEqual(
          [inviteId, requestId, deviceId],
          [pending.inviteId, pending.requestId, pending.requesterDeviceId]
        );
      },
      clear: async (requestId, roomId) => {
        events.push("clear");
        assert.deepEqual([requestId, roomId], [pending.requestId, pending.roomId]);
      }
    })
  );

  assert.equal(result, "denied");
  assert.deepEqual(events, ["accept", "ack", "clear"]);
});

test("transient failures retain the durable pending request", async (t) => {
  await t.test("relay response load failures propagate without clearing", async () => {
    let cleared = false;
    const failure = new Error("relay unavailable");
    await assert.rejects(
      processPendingInviteRecoveryAttempt(
        pending,
        dependencies({
          loadResponse: async () => {
            throw failure;
          },
          clear: async () => {
            cleared = true;
          }
        })
      ),
      failure
    );
    assert.equal(cleared, false);
  });

  await t.test("admission failures preserve the accepted request for retry", async () => {
    let cleared = false;
    const result: PendingInviteRecoveryResult = await processPendingInviteRecoveryAttempt(
      pending,
      dependencies({
        loadResponse: async () => response,
        completeAdmission: async () => {
          throw new Error("relay admission unavailable");
        },
        clear: async () => {
          cleared = true;
        }
      })
    );
    assert.equal(result, "admission-pending");
    assert.equal(cleared, false);
  });
});

test("recovery orchestration automatically retries a transient relay error and succeeds", async () => {
  let loads = 0;
  const delays: number[] = [];
  const events: string[] = [];
  const result = await runPendingInviteRecoveryLoop(
    pending,
    dependencies({
      loadResponse: async () => {
        loads += 1;
        if (loads === 1) throw new Error("temporary relay read failure");
        return response;
      },
      acceptResponse: async () => {
        events.push("accept");
        return { status: "approved" };
      },
      completeAdmission: async () => {
        events.push("admit");
      }
    }),
    {
      maxAttempts: 3,
      initialErrorBackoffMs: 100,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }
  );

  assert.equal(result, "approved");
  assert.equal(loads, 2);
  assert.deepEqual(delays, [100]);
  assert.deepEqual(events, ["accept", "admit"]);
});

test("transient denial ACK failure retries without clearing native recovery early", async () => {
  const events: string[] = [];
  let acknowledgements = 0;
  const result = await runPendingInviteRecoveryLoop(
    pending,
    dependencies({
      loadResponse: async () => ({ ...response, welcome: undefined }),
      acceptResponse: async () => {
        events.push("accept");
        return { status: "denied" };
      },
      acknowledge: async () => {
        acknowledgements += 1;
        events.push(`ack-${acknowledgements}`);
        if (acknowledgements === 1) throw new RelayHttpError("temporary ACK failure", 503, null);
      },
      clear: async () => {
        events.push("clear");
      }
    }),
    { maxAttempts: 3, sleep: async () => undefined }
  );

  assert.equal(result, "denied");
  assert.deepEqual(events, ["accept", "ack-1", "accept", "ack-2", "clear"]);
});

test("structured relay status controls retry regardless of message wording", async (t) => {
  await t.test("structured 5xx containing terminal-looking text still retries", async () => {
    let loads = 0;
    const result = await runPendingInviteRecoveryLoop(
      pending,
      dependencies({
        loadResponse: async () => {
          loads += 1;
          if (loads === 1) throw new RelayHttpError("invalid request", 503, "invalid_request");
          return response;
        }
      }),
      { maxAttempts: 2, sleep: async () => undefined }
    );
    assert.equal(result, "approved");
    assert.equal(loads, 2);
  });

  await t.test("structured terminal status stops without retry", async () => {
    let loads = 0;
    const delays: number[] = [];
    const failure = new RelayHttpError("try again", 409, "conflict");
    await assert.rejects(
      runPendingInviteRecoveryLoop(
        pending,
        dependencies({
          loadResponse: async () => {
            loads += 1;
            throw failure;
          }
        }),
        { maxAttempts: 3, sleep: async (delay) => void delays.push(delay) }
      ),
      failure
    );
    assert.equal(loads, 1);
    assert.deepEqual(delays, []);
  });
});

test("transient retry exhaustion respects the cumulative error-delay budget", async () => {
  let loads = 0;
  const delays: number[] = [];
  const failure = new RelayHttpError("relay unavailable", 503, null);
  await assert.rejects(
    runPendingInviteRecoveryLoop(
      pending,
      dependencies({
        loadResponse: async () => {
          loads += 1;
          throw failure;
        }
      }),
      {
        maxAttempts: 20,
        initialErrorBackoffMs: 100,
        maxErrorBackoffMs: 100,
        maxErrorDelayMs: 250,
        sleep: async (delay) => void delays.push(delay)
      }
    ),
    failure
  );
  assert.equal(loads, 4);
  assert.deepEqual(delays, [100, 100, 50]);
});

test("expired recovery clears the exact durable record without republishing", async () => {
  const events: string[] = [];
  const result = await processPendingInviteRecoveryAttempt(
    pending,
    dependencies({
      publishRequest: async () => {
        events.push("publish");
      },
      clear: async (requestId, roomId) => {
        events.push("clear");
        assert.deepEqual([requestId, roomId], [pending.requestId, pending.roomId]);
      }
    }),
    Date.parse(pending.expiresAt)
  );

  assert.equal(result, "expired");
  assert.deepEqual(events, ["clear"]);
});

test("missing relay invite clears the exact durable record while transient lookup failures retain it", async () => {
  const cleared: Array<[string, string]> = [];
  const clear = async (requestId: string, roomId: string) => {
    cleared.push([requestId, roomId]);
  };

  assert.equal(await clearPendingInviteIfMissing(new Error("Invite not found"), pending, clear), true);
  assert.deepEqual(cleared, [[pending.requestId, pending.roomId]]);

  assert.equal(await clearPendingInviteIfMissing(new Error("Relay unavailable"), pending, clear), false);
  assert.deepEqual(cleared, [[pending.requestId, pending.roomId]]);

  assert.equal(
    await clearPendingInviteIfMissing(
      new RelayHttpError("upstream mentioned 404", 500, "internal_error"),
      pending,
      clear
    ),
    false
  );
  assert.deepEqual(cleared, [[pending.requestId, pending.roomId]]);
});

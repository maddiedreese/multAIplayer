import type { MlsInviteCapabilityBinding, PendingMlsInviteRequest } from "../mls/mlsClient";
import { RelayHttpError } from "../core/httpResponse";
import { reportExpectedFailure } from "../core/nonFatalReporting";

interface DirectedResponse {
  responseBinding: unknown;
  responseMac: string;
  welcome?: string;
}

type PublishPendingInviteRequest = PendingInviteRecoveryDependencies["publishRequest"];

interface PendingInviteRecoveryDependencies {
  loadResponse: (inviteId: string, requestId: string, requesterDeviceId: string) => Promise<DirectedResponse | null>;
  publishRequest: (
    inviteId: string,
    request: {
      requestId: string;
      requesterDeviceId: string;
      keyPackageId: string;
      keyPackageHash: string;
      sealedRequest: string;
    }
  ) => Promise<void>;
  acceptResponse: (
    requestId: string,
    responseBinding: MlsInviteCapabilityBinding,
    responseMac: string,
    welcome?: string
  ) => Promise<{ status: "approved" | "denied" }>;
  acknowledge: (inviteId: string, requestId: string, requesterDeviceId: string) => Promise<void>;
  clear: (requestId: string, roomId: string) => Promise<void>;
  completeAdmission: (pending: PendingMlsInviteRequest) => Promise<void>;
}

export type PendingInviteRecoveryResult = "pending" | "expired" | "denied" | "approved" | "admission-pending";
export type PendingInviteRecoveryLoopResult = Exclude<PendingInviteRecoveryResult, "pending"> | "timed-out";

interface PendingInviteRecoveryLoopOptions {
  maxAttempts?: number;
  pendingPollMs?: number;
  initialErrorBackoffMs?: number;
  maxErrorBackoffMs?: number;
  maxErrorDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

class InviteRecoveryTransportError extends Error {
  constructor(readonly cause: unknown) {
    super("Pending invite relay transport failed");
  }
}

function isTerminalRelayError(error: unknown): boolean {
  if (error instanceof RelayHttpError) {
    if (error.status >= 500 || [408, 429].includes(error.status)) return false;
    if (
      error.code &&
      [
        "persistence_unavailable",
        "upstream_unavailable",
        "relay_shutting_down",
        "internal_error",
        "rate_limited"
      ].includes(error.code)
    )
      return false;
    return error.status >= 400 && error.status < 500;
  }
  return /not found|conflict|invalid|forbidden|unauthorized|\b(?:400|401|403|404|409)\b/i.test(String(error));
}

export async function clearPendingInviteIfMissing(
  error: unknown,
  pending: PendingMlsInviteRequest,
  clear: (requestId: string, roomId: string) => Promise<void>
): Promise<boolean> {
  const missing =
    error instanceof RelayHttpError
      ? error.status === 404 || error.code === "invite_not_found" || error.code === "not_found"
      : /not found|404/i.test(String(error));
  if (!missing) return false;
  await clear(pending.requestId, pending.roomId);
  return true;
}

export async function publishPendingInviteRequest(
  pending: PendingMlsInviteRequest,
  publish: PublishPendingInviteRequest
): Promise<void> {
  await publish(pending.inviteId, {
    requestId: pending.requestId,
    requesterDeviceId: pending.requesterDeviceId,
    keyPackageId: pending.keyPackageId,
    keyPackageHash: pending.keyPackageHash,
    sealedRequest: pending.sealedRequest
  });
}

export async function processPendingInviteRecoveryAttempt(
  pending: PendingMlsInviteRequest,
  dependencies: PendingInviteRecoveryDependencies,
  now = Date.now()
): Promise<PendingInviteRecoveryResult> {
  const response = await dependencies.loadResponse(pending.inviteId, pending.requestId, pending.requesterDeviceId);
  if (!response) {
    if (Date.parse(pending.expiresAt) <= now) {
      await dependencies.clear(pending.requestId, pending.roomId);
      return "expired";
    }
    await publishPendingInviteRequest(pending, dependencies.publishRequest);
    return "pending";
  }

  const accepted = await dependencies.acceptResponse(
    pending.requestId,
    response.responseBinding as MlsInviteCapabilityBinding,
    response.responseMac,
    response.welcome
  );
  if (accepted.status === "denied") {
    await dependencies.acknowledge(pending.inviteId, pending.requestId, pending.requesterDeviceId);
    await dependencies.clear(pending.requestId, pending.roomId);
    return "denied";
  }
  try {
    await dependencies.completeAdmission(pending);
    return "approved";
  } catch {
    // Native acceptance created a durable join admission. The relay subscription resumes it.
    reportExpectedFailure("pending invite relay admission deferred");
    return "admission-pending";
  }
}

export async function runPendingInviteRecoveryLoop(
  pending: PendingMlsInviteRequest,
  dependencies: PendingInviteRecoveryDependencies,
  options: PendingInviteRecoveryLoopOptions = {}
): Promise<PendingInviteRecoveryLoopResult> {
  const maxAttempts = options.maxAttempts ?? 150;
  const pendingPollMs = options.pendingPollMs ?? 2_000;
  const initialErrorBackoffMs = options.initialErrorBackoffMs ?? 1_000;
  const maxErrorBackoffMs = options.maxErrorBackoffMs ?? 15_000;
  const maxErrorDelayMs = options.maxErrorDelayMs ?? 300_000;
  const sleep =
    options.sleep ?? ((milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  let consecutiveErrors = 0;
  let totalErrorDelayMs = 0;
  const retryableDependencies: PendingInviteRecoveryDependencies = {
    ...dependencies,
    loadResponse: async (...args) => {
      try {
        return await dependencies.loadResponse(...args);
      } catch (error) {
        throw new InviteRecoveryTransportError(error);
      }
    },
    publishRequest: async (...args) => {
      try {
        await dependencies.publishRequest(...args);
      } catch (error) {
        throw new InviteRecoveryTransportError(error);
      }
    },
    acknowledge: async (...args) => {
      try {
        await dependencies.acknowledge(...args);
      } catch (error) {
        throw new InviteRecoveryTransportError(error);
      }
    }
  };

  let pendingAttempts = 0;
  while (pendingAttempts < maxAttempts) {
    try {
      const result = await processPendingInviteRecoveryAttempt(pending, retryableDependencies);
      consecutiveErrors = 0;
      if (result !== "pending") return result;
      pendingAttempts += 1;
      if (pendingAttempts < maxAttempts) await sleep(pendingPollMs);
    } catch (error) {
      if (!(error instanceof InviteRecoveryTransportError) || isTerminalRelayError(error.cause)) {
        throw error instanceof InviteRecoveryTransportError ? error.cause : error;
      }
      if (totalErrorDelayMs >= maxErrorDelayMs) throw error.cause;
      const backoff = Math.min(
        initialErrorBackoffMs * 2 ** consecutiveErrors,
        maxErrorBackoffMs,
        maxErrorDelayMs - totalErrorDelayMs
      );
      consecutiveErrors += 1;
      totalErrorDelayMs += backoff;
      await sleep(backoff);
    }
  }
  return "timed-out";
}

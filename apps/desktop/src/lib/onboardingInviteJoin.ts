import { parseInviteInput } from "./inviteActionsHelpers";
import { readInviteUrlPayload, type InviteUrlParts } from "./inviteUrl";
import { RelayHttpError } from "./httpResponse";
import { reportExpectedFailure } from "./nonFatalReporting";
import { isInviteJoinError } from "./inviteJoinError";

export type OnboardingInviteJoinStatus =
  | "no_invite"
  | "approval_pending"
  | "invalid_invite"
  | "legacy_invite"
  | "expired_invite"
  | "sign_in_required"
  | "verification_failed"
  | "temporarily_unavailable";

export interface OnboardingInviteJoinResult {
  status: OnboardingInviteJoinStatus;
  message: string;
  blocking: boolean;
  retryable: boolean;
}

export interface OnboardingInviteJoinAdapter {
  joinManualInput: (input: string) => Promise<OnboardingInviteJoinResult>;
  joinProtectedPayload: (encodedInvite: string, inviteId: string) => Promise<OnboardingInviteJoinResult>;
  joinFromUrl: (
    location: InviteUrlParts,
    scrubUrl: (cleanupPath: string) => void
  ) => Promise<OnboardingInviteJoinResult>;
}

interface OnboardingInviteJoinPort {
  /** The existing capability-bound MLS join action. */
  requestNoSecretInviteAccess: (encodedInvite: string, inviteId?: string | null) => Promise<void>;
}

/**
 * Adapts onboarding inputs to the existing MLS request flow. A resolved request
 * means only that active-host device approval is pending; this layer has no
 * authority to unlock a room or synthesize an admission result.
 */
export function createOnboardingInviteJoinAdapter({
  requestNoSecretInviteAccess
}: OnboardingInviteJoinPort): OnboardingInviteJoinAdapter {
  async function request(encodedInvite: string, inviteId: string | null): Promise<OnboardingInviteJoinResult> {
    try {
      await requestNoSecretInviteAccess(encodedInvite, inviteId);
      return result(
        "approval_pending",
        "Access requested. The active host must verify and approve this device before the room unlocks.",
        true,
        false
      );
    } catch (error) {
      return safeJoinFailure(error);
    }
  }

  return {
    async joinProtectedPayload(encodedInvite, inviteId) {
      if (!encodedInvite || !inviteId) {
        return result("invalid_invite", "Paste a complete multAIplayer invite link to continue.", true, false);
      }
      return request(encodedInvite, inviteId);
    },

    async joinManualInput(input) {
      const normalized = input.trim();
      if (!normalized) {
        return result("invalid_invite", "Paste a complete multAIplayer invite link to continue.", true, false);
      }
      try {
        const parsed = parseInviteInput(normalized);
        return request(parsed.joinInvite, parsed.inviteId);
      } catch (error) {
        return safeJoinFailure(error);
      }
    },

    async joinFromUrl(location, scrubUrl) {
      const payload = readInviteUrlPayload(location);
      if (!payload) return result("no_invite", "No invite was found in this link.", false, false);

      // Scrub the fragment before parsing, validation, native work, or network I/O.
      // If scrubbing fails, do not continue with a bearer capability in the URL.
      try {
        scrubUrl(payload.cleanupPath);
      } catch {
        reportExpectedFailure("onboarding invite URL cleanup was unavailable");
        return result(
          "temporarily_unavailable",
          "The invite could not be opened safely. Close this window and paste the invite into the app.",
          true,
          true
        );
      }

      if (payload.kind === "legacy-secret") {
        return result(
          "legacy_invite",
          "This legacy invite is no longer accepted. Ask the active host for a new approval-gated invite.",
          true,
          false
        );
      }
      return request(payload.encoded, payload.inviteId);
    }
  };
}

function safeJoinFailure(error: unknown): OnboardingInviteJoinResult {
  if (error instanceof RelayHttpError) {
    if (error.code === "authentication_required" || error.status === 401) {
      return result("sign_in_required", "Sign in with GitHub before requesting access with this invite.", true, true);
    }
    if (error.code === "invite_expired" || error.status === 410) {
      return result("expired_invite", "This invite has expired. Ask the active host for a new one.", true, false);
    }
    if (error.code === "invite_not_found" || error.status === 404) {
      return result(
        "invalid_invite",
        "This invite is no longer available. Ask the active host for a new one.",
        true,
        false
      );
    }
  }

  if (isInviteJoinError(error)) {
    switch (error.code) {
      case "invite_expired":
        return result("expired_invite", "This invite has expired. Ask the active host for a new one.", true, false);
      case "legacy_invite":
        return result(
          "legacy_invite",
          "This legacy invite is no longer accepted. Ask the active host for a new approval-gated invite.",
          true,
          false
        );
      case "active_host_mismatch":
      case "host_hpke_key_mismatch":
      case "invite_metadata_mismatch":
      case "key_package_hash_mismatch":
      case "pending_recovery_mismatch":
        return result(
          "verification_failed",
          "The invite could not be verified against the active host device. Ask the host for a new invite.",
          true,
          false
        );
      case "invalid_invite":
      case "invite_id_missing":
        return result("invalid_invite", "Paste a complete, current multAIplayer invite link.", true, false);
    }
  }
  return result(
    "temporarily_unavailable",
    "The invite request could not be completed. Check the connection and try again.",
    true,
    true
  );
}

function result(
  status: OnboardingInviteJoinStatus,
  message: string,
  blocking: boolean,
  retryable: boolean
): OnboardingInviteJoinResult {
  return { status, message, blocking, retryable };
}

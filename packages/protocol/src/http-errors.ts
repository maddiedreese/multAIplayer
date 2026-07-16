import { z } from "zod";
import { maxMediumTextChars } from "./limits-ids.js";

export const RelayHttpErrorCode = z.enum([
  "invalid_request",
  "authentication_required",
  "account_deletion_blocked",
  "account_restricted",
  "device_auth_required",
  "forbidden",
  "not_found",
  "team_not_found",
  "team_member_not_found",
  "room_not_found",
  "invite_not_found",
  "invite_expired",
  "conflict",
  "rate_limited",
  "quota_exceeded",
  "payload_too_large",
  "capacity_exceeded",
  "persistence_unavailable",
  "upstream_unavailable",
  "relay_shutting_down",
  "key_package_invalid",
  "key_package_unavailable",
  "internal_error"
]);

export const RelayHttpErrorResponse = z
  .object({
    error: z.string().min(1).max(maxMediumTextChars),
    code: RelayHttpErrorCode
  })
  .passthrough();

export type RelayHttpErrorCode = z.infer<typeof RelayHttpErrorCode>;
export type RelayHttpErrorResponse = z.infer<typeof RelayHttpErrorResponse>;

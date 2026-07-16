export type InviteJoinErrorCode =
  | "active_host_mismatch"
  | "host_hpke_key_mismatch"
  | "invalid_invite"
  | "invite_expired"
  | "invite_id_missing"
  | "invite_metadata_mismatch"
  | "key_package_hash_mismatch"
  | "pending_recovery_mismatch";

export class InviteJoinError extends Error {
  override readonly name = "InviteJoinError";

  constructor(
    readonly code: InviteJoinErrorCode,
    message: string
  ) {
    super(message);
  }
}

export function isInviteJoinError(error: unknown): error is InviteJoinError {
  return error instanceof InviteJoinError;
}

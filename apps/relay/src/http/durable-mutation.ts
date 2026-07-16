/**
 * Complete the persistence half of an already-applied in-memory mutation.
 *
 * The persistence coordinator decides whether a write failure is an expected
 * optimistic conflict or a poison event. This helper has one narrower job:
 * restore the caller's exact pre-mutation snapshot before it returns failure.
 * Rollback does not make a poisoned coordinator healthy again.
 */
export async function persistMutationOrRollback(options: {
  persist: () => Promise<void>;
  rollback: () => void;
}): Promise<boolean> {
  try {
    await options.persist();
    return true;
  } catch (persistenceError) {
    try {
      options.rollback();
    } catch (rollbackError) {
      throw new RelayMutationRollbackError(persistenceError, rollbackError);
    }
    return false;
  }
}

export class RelayMutationRollbackError extends Error {
  override readonly name = "RelayMutationRollbackError";
  readonly persistenceError: unknown;
  readonly rollbackError: unknown;

  constructor(persistenceError: unknown, rollbackError: unknown) {
    super("Relay in-memory mutation rollback failed after persistence failure.", { cause: rollbackError });
    this.persistenceError = persistenceError;
    this.rollbackError = rollbackError;
  }
}

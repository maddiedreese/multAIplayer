interface CleanupState {
  active: Promise<void> | null;
  failure: unknown;
}

const cleanupByRoom = new Map<string, CleanupState>();

/** Coalesces room deletion and keeps failed cleanup as a rejoin gate until a retry succeeds. */
export function runRoomLocalDataCleanup(roomId: string, operation: () => Promise<void>): Promise<void> {
  const current = cleanupByRoom.get(roomId);
  if (current?.active) return current.active;
  const state: CleanupState = current ?? { active: null, failure: undefined };
  const active = Promise.resolve()
    .then(operation)
    .then(
      () => {
        if (cleanupByRoom.get(roomId) === state) cleanupByRoom.delete(roomId);
      },
      (error) => {
        state.failure = error;
        throw error;
      }
    );
  state.active = active.finally(() => {
    state.active = null;
  });
  cleanupByRoom.set(roomId, state);
  return state.active;
}

export async function waitForRoomLocalDataCleanup(roomId: string): Promise<void> {
  const state = cleanupByRoom.get(roomId);
  if (!state) return;
  if (state.active) await state.active;
  if (state.failure !== undefined) {
    throw new Error("Previous local room cleanup must be retried before rejoining.", { cause: state.failure });
  }
}

export function resetRoomLocalDataCleanupForTests(): void {
  cleanupByRoom.clear();
}

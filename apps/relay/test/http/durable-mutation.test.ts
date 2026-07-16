import assert from "node:assert/strict";
import test from "node:test";
import { persistMutationOrRollback, RelayMutationRollbackError } from "../../src/http/durable-mutation.js";

test("a durable mutation keeps its applied state only after persistence commits", async () => {
  const events: string[] = ["apply"];
  const committed = await persistMutationOrRollback({
    persist: async () => {
      events.push("persist");
    },
    rollback: () => events.push("rollback")
  });

  assert.equal(committed, true);
  assert.deepEqual(events, ["apply", "persist"]);
});

test("a failed durable mutation restores its in-memory snapshot before reporting failure", async () => {
  const events: string[] = ["apply"];
  const committed = await persistMutationOrRollback({
    persist: async () => {
      events.push("persist");
      throw new Error("disk full");
    },
    rollback: () => events.push("rollback")
  });

  assert.equal(committed, false);
  assert.deepEqual(events, ["apply", "persist", "rollback"]);
});

test("rollback failure is never mistaken for a cleanly rejected mutation", async () => {
  const persistenceError = new Error("disk full");
  const rollbackError = new Error("invalid snapshot");

  await assert.rejects(
    persistMutationOrRollback({
      persist: async () => {
        throw persistenceError;
      },
      rollback: () => {
        throw rollbackError;
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof RelayMutationRollbackError);
      assert.equal(error.persistenceError, persistenceError);
      assert.equal(error.rollbackError, rollbackError);
      return true;
    }
  );
});

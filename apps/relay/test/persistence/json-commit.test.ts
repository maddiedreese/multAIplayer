import test from "node:test";
import { chmod, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileRelayPersistence } from "../../src/json-file-persistence.js";
import { assert } from "../support/relay.js";

test("JSON persistence performs every fallible permission operation before the atomic rename commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "multaiplayer-json-commit-"));
  const dataPath = join(directory, "relay.json");
  let committed = false;
  const persistence = new JsonFileRelayPersistence(dataPath, {
    writeFile,
    async chmod(path, mode) {
      if (committed) throw new Error("post-commit operation must not run");
      await chmod(path, mode);
    },
    async rename(from, to) {
      await rename(from, to);
      committed = true;
    }
  });
  try {
    await persistence.save({ version: 1 });
    assert.equal(committed, true);
  } finally {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import { createServer } from "node:http";
import { assert } from "../support/relay.js";
import { fetchUpstream } from "../../src/http/upstream.js";

test("upstream fetches fail closed on timeout", async () => {
  const server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetchUpstream(`http://127.0.0.1:${address.port}`, {}, 5);
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: "Upstream request timed out." });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

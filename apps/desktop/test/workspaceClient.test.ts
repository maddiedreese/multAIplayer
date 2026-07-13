import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse, RelayHttpError } from "../src/lib/httpResponse";

test("readJsonResponse surfaces relay auth errors", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Sign in with GitHub before reading workspace state.",
      code: "authentication_required"
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" }
    }
  );

  const error = await readJsonResponse(response, "Failed to load workspace").catch((caught: unknown) => caught);
  assert.ok(error instanceof RelayHttpError);
  assert.equal(error.status, 401);
  assert.equal(error.code, "authentication_required");
  assert.match(error.message, /Sign in with GitHub/);
});

test("readJsonResponse includes HTTP status for non-json failures", async () => {
  const response = new Response("gateway down", { status: 502 });

  await assert.rejects(
    () => readJsonResponse(response, "Failed to load workspace"),
    /Failed to load workspace: HTTP 502/
  );
});

test("readJsonResponse returns typed JSON bodies", async () => {
  const response = new Response(JSON.stringify({ teams: [], rooms: [] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  assert.deepEqual(await readJsonResponse<{ teams: unknown[]; rooms: unknown[] }>(response, "Failed"), {
    teams: [],
    rooms: []
  });
});

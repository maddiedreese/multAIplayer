import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse } from "../src/lib/httpResponse";

test("readJsonResponse surfaces relay auth errors", async () => {
  const response = new Response(
    JSON.stringify({ error: "Sign in with GitHub before reading workspace state." }),
    {
      status: 401,
      headers: { "content-type": "application/json" }
    }
  );

  await assert.rejects(
    () => readJsonResponse(response, "Failed to load workspace"),
    /Sign in with GitHub before reading workspace state/
  );
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

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { persistenceAvailabilityMiddleware } from "../../src/http/persistence-availability.js";

test("a poisoned persistence boundary refuses API traffic but keeps operational probes available", async () => {
  const app = express();
  app.use(persistenceAvailabilityMiddleware(() => false));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/teams", (_req, res) => res.json({ leaked: true }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const refused = await fetch(`${baseUrl}/teams`);
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), {
      error: "Relay persistence is unavailable. Restart the relay before retrying.",
      code: "persistence_unavailable"
    });
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

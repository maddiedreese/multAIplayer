import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileDeletionLedger, S3DeletionLedger } from "../src/auth/deletion-ledger.js";

const key = "test-deletion-ledger-hmac-key-with-more-than-32-characters";

test("file ledger appends authenticated pseudonymous tombstones for repeated cleanup attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deletion-ledger-"));
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const ledger = new FileDeletionLedger(directory, key, 7_776_000, now);
  try {
    const first = await ledger.record("github:12345");
    const second = await ledger.record("github:12345");
    assert.notEqual(second.id, first.id);
    assert.equal(second.subject, first.subject);
    assert.equal(first.protectUntil, "2026-10-12T12:00:00.000Z");
    assert.equal((await readdir(directory)).length, 2);
    assert.doesNotMatch(await readFile(join(directory, `${first.id}.json`), "utf8"), /github|12345/);
    assert.equal(ledger.isProtected("github:12345"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file ledger rejects tampering and safely purges after the protection horizon", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deletion-ledger-"));
  let current = new Date("2026-07-14T12:00:00.000Z");
  const ledger = new FileDeletionLedger(directory, key, 86_400, () => current);
  try {
    const entry = await ledger.record("github:55");
    const path = join(directory, `${entry.id}.json`);
    const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...stored, protectUntil: "2099-01-01T00:00:00.000Z" }));
    await assert.rejects(() => ledger.list(), /authentication failed/);
    await writeFile(path, JSON.stringify(stored));
    current = new Date("2026-07-15T12:00:00.000Z");
    assert.equal(await ledger.purgeExpired(), 1);
    assert.deepEqual(await ledger.list(), []);
    assert.equal(ledger.isProtected("github:55"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("S3 ledger signs Railway-compatible virtual-host requests", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  let storedBody = "";
  let putCount = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (init.method === "PUT") {
      putCount += 1;
      storedBody = String(init.body);
      return new Response("", { status: putCount === 1 ? 200 : 412 });
    }
    if (url.searchParams.get("list-type") === "2") {
      const id = JSON.parse(storedBody).id as string;
      return new Response(
        `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>relay-deletions/v1/${id}.json</Key></Contents></ListBucketResult>`,
        { status: 200 }
      );
    }
    if (init.method === "GET") return new Response(storedBody, { status: 200 });
    return new Response("", { status: 200 });
  };
  const ledger = new S3DeletionLedger({
    endpoint: "https://t3.storageapi.dev",
    bucket: "generated-bucket-name",
    region: "auto",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-access-key-with-at-least-32-characters",
    hmacKey: key,
    prefix: "relay-deletions/v1",
    protectionSeconds: 7_776_000,
    urlStyle: "virtual-host",
    fetchImpl,
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    randomId: () => "fixed-random-id"
  });
  const first = await ledger.record("github:77");
  assert.deepEqual(await ledger.record("github:77"), first);
  assert.deepEqual(await ledger.list(), [first]);
  assert.equal(requests.length, 5);
  assert.equal(requests[0]?.url.host, "generated-bucket-name.t3.storageapi.dev");
  assert.match(requests[0]?.url.pathname ?? "", /^\/relay-deletions\/v1\/[a-f0-9]{64}\.[0-9]+\.fixed-random-id\.json$/);
  const headers = requests[0]?.init.headers as Record<string, string>;
  assert.match(headers.authorization, /Credential=test-access-key\/20260714\/auto\/s3\/aws4_request/);
  assert.match(headers.authorization, /SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);
  assert.doesNotMatch(String(requests[0]?.init.body), /github:77/);
  assert.equal(
    requests
      .filter((request) => request.init.method !== "PUT")
      .every((request) => !Object.hasOwn(request.init, "body")),
    true
  );
  assert.equal(requests[3]?.url.searchParams.get("prefix"), "relay-deletions/v1/");
});

test("S3 ledger keeps bucket in the canonical path when path URL style is configured", async () => {
  let requestUrl: URL | null = null;
  const ledger = new S3DeletionLedger({
    endpoint: "https://storage.example.test/base",
    bucket: "relay-ledger",
    region: "us-west-2",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-access-key-with-at-least-32-characters",
    hmacKey: key,
    prefix: "deletions",
    protectionSeconds: 7_776_000,
    urlStyle: "path",
    fetchImpl: async (input) => {
      requestUrl = new URL(String(input));
      return new Response("", { status: 200 });
    },
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    randomId: () => "fixed-random-id"
  });
  await ledger.record("github:88");
  assert.equal(requestUrl!.host, "storage.example.test");
  assert.match(requestUrl!.pathname, /^\/base\/relay-ledger\/deletions\/[a-f0-9]{64}\./);
});

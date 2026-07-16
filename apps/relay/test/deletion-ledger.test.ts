import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { FileDeletionLedger, maxDeletionLedgerEntries, S3DeletionLedger } from "../src/auth/deletion-ledger.js";

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

test("S3 ledger delegates object transport to the maintained client and authenticates listed entries", async () => {
  const requests: unknown[] = [];
  let storedBody = "";
  const client = {
    async send(command: unknown): Promise<unknown> {
      requests.push(command);
      if (command instanceof PutObjectCommand) {
        storedBody = String(command.input.Body);
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        const id = JSON.parse(storedBody).id as string;
        return { IsTruncated: false, Contents: [{ Key: `relay-deletions/v1/${id}.json` }] };
      }
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToString: async () => storedBody } };
      }
      throw new Error("Unexpected command");
    }
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
    client,
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    randomId: () => "fixed-random-id"
  });
  const first = await ledger.record("github:77");
  assert.deepEqual(await ledger.list(), [first]);
  assert.equal(requests.length, 3);
  const put = requests[0] as PutObjectCommand;
  assert.equal(put.input.Bucket, "generated-bucket-name");
  assert.match(put.input.Key ?? "", /^relay-deletions\/v1\/[a-f0-9]{64}\.[0-9]+\.fixed-random-id\.json$/);
  assert.equal(put.input.IfNoneMatch, "*");
  assert.doesNotMatch(String(put.input.Body), /github:77/);
});

test("S3 ledger refuses an unbounded startup scan before fetching object bodies", async () => {
  let gets = 0;
  const client = {
    async send(command: unknown): Promise<unknown> {
      if (command instanceof ListObjectsV2Command) {
        return {
          IsTruncated: false,
          Contents: Array.from({ length: maxDeletionLedgerEntries + 1 }, (_, index) => ({
            Key: `deletions/${index}.json`
          }))
        };
      }
      if (command instanceof GetObjectCommand) gets += 1;
      return {};
    }
  };
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
    client,
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    randomId: () => "fixed-random-id"
  });
  await assert.rejects(() => ledger.list(), /10000-entry startup reconciliation bound/);
  assert.equal(gets, 0);
});

test("S3 ledger reads a bounded object batch concurrently", async () => {
  let activeReads = 0;
  let maximumActiveReads = 0;
  const entries = Array.from({ length: 33 }, (_, index) => {
    const subject = "a".repeat(64);
    const requestedAt = "2026-07-14T12:00:00.000Z";
    const id = `${subject}.${Date.parse(requestedAt)}.fixed-id-${index}`;
    return { id, key: `deletions/${id}.json` };
  });
  const source = new S3DeletionLedger({
    endpoint: "https://storage.example.test",
    bucket: "relay-ledger",
    region: "auto",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    hmacKey: key,
    prefix: "deletions",
    protectionSeconds: 7_776_000,
    urlStyle: "path",
    client: { send: async () => ({}) },
    now: () => new Date("2026-07-14T12:00:00.000Z")
  });
  const authenticated = await Promise.all(entries.map((entry, index) => source.record(`github:${index}`)));
  const byKey = new Map(authenticated.map((entry) => [`deletions/${entry.id}.json`, JSON.stringify(entry)]));
  const ledger = new S3DeletionLedger({
    endpoint: "https://storage.example.test",
    bucket: "relay-ledger",
    region: "auto",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    hmacKey: key,
    prefix: "deletions",
    protectionSeconds: 7_776_000,
    urlStyle: "path",
    client: {
      async send(command: unknown): Promise<unknown> {
        if (command instanceof ListObjectsV2Command) {
          return {
            IsTruncated: false,
            Contents: authenticated.map((entry) => ({ Key: `deletions/${entry.id}.json` }))
          };
        }
        if (command instanceof GetObjectCommand) {
          activeReads += 1;
          maximumActiveReads = Math.max(maximumActiveReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeReads -= 1;
          return { Body: { transformToString: async () => byKey.get(command.input.Key!)! } };
        }
        throw new Error("Unexpected command");
      }
    }
  });
  assert.equal((await ledger.list()).length, 33);
  assert.ok(maximumActiveReads > 1);
  assert.ok(maximumActiveReads <= 16);
});

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export interface DeletionLedgerEntry {
  version: 1;
  id: string;
  subject: string;
  requestedAt: string;
  protectUntil: string;
  mac: string;
}

export interface DeletionLedger {
  record(userId: string): Promise<DeletionLedgerEntry>;
  list(): Promise<DeletionLedgerEntry[]>;
  purgeExpired(entries?: readonly DeletionLedgerEntry[]): Promise<number>;
  subjectFor(userId: string): string;
  isProtected(userId: string): boolean;
}

export interface S3DeletionLedgerOptions {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  urlStyle: "path" | "virtual-host";
  hmacKey: string;
  protectionSeconds: number;
  client?: Pick<S3Client, "send">;
  now?: () => Date;
  randomId?: () => string;
}

export const maxDeletionLedgerEntries = 10_000;
const deletionLedgerReadConcurrency = 16;

export class FileDeletionLedger implements DeletionLedger {
  private readonly protectedSubjects = new Set<string>();
  constructor(
    private readonly directory: string,
    private readonly hmacKey: string,
    private readonly protectionSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly randomId: () => string = randomUUID
  ) {}

  subjectFor(userId: string): string {
    return deletionSubject(this.hmacKey, userId);
  }
  isProtected(userId: string): boolean {
    return this.protectedSubjects.has(this.subjectFor(userId));
  }

  async record(userId: string): Promise<DeletionLedgerEntry> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entry = createDeletionLedgerEntry(
      this.hmacKey,
      userId,
      this.now().toISOString(),
      this.protectionSeconds,
      this.randomId()
    );
    const path = join(this.directory, `${entry.id}.json`);
    try {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(entry));
        await file.sync();
      } finally {
        await file.close();
      }
      const directoryHandle = await open(this.directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stored = parseDeletionLedgerEntry(this.hmacKey, await readFile(path, "utf8"), entry.id);
    this.protectedSubjects.add(stored.subject);
    return stored;
  }

  async list(): Promise<DeletionLedgerEntry[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
    const entries = await Promise.all(
      names.map(async (name) =>
        parseDeletionLedgerEntry(this.hmacKey, await readFile(join(this.directory, name), "utf8"), name.slice(0, -5))
      )
    );
    this.protectedSubjects.clear();
    for (const entry of entries) this.protectedSubjects.add(entry.subject);
    return entries;
  }

  async purgeExpired(entries?: readonly DeletionLedgerEntry[]): Promise<number> {
    const { unlink } = await import("node:fs/promises");
    const now = this.now().getTime();
    let purged = 0;
    entries ??= await this.list();
    for (const entry of entries) {
      if (Date.parse(entry.protectUntil) > now) continue;
      await unlink(join(this.directory, `${entry.id}.json`));
      purged += 1;
    }
    if (purged > 0) {
      const directoryHandle = await open(this.directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
    if (purged > 0) {
      this.protectedSubjects.clear();
      for (const entry of entries) if (Date.parse(entry.protectUntil) > now) this.protectedSubjects.add(entry.subject);
    }
    return purged;
  }
}

/**
 * An append-only deletion ledger backed by an S3-compatible bucket. Objects are
 * immutable and contain no GitHub id, login, access token, or record inventory.
 */
export class S3DeletionLedger implements DeletionLedger {
  private readonly protectedSubjects = new Set<string>();
  private readonly client: Pick<S3Client, "send">;
  private readonly now: () => Date;
  private readonly prefix: string;
  private readonly randomId: () => string;

  constructor(private readonly options: S3DeletionLedgerOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
      throw new Error("Deletion ledger endpoint must use HTTPS.");
    }
    this.client = options.client ?? createS3Client(options);
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
    this.prefix = options.prefix.replace(/^\/+|\/+$/g, "") || "relay-deletions/v1";
  }

  subjectFor(userId: string): string {
    return deletionSubject(this.options.hmacKey, userId);
  }
  isProtected(userId: string): boolean {
    return this.protectedSubjects.has(this.subjectFor(userId));
  }

  async record(userId: string): Promise<DeletionLedgerEntry> {
    const requestedAt = this.now().toISOString();
    const entry = createDeletionLedgerEntry(
      this.options.hmacKey,
      userId,
      requestedAt,
      this.options.protectionSeconds,
      this.randomId()
    );
    const { id } = entry;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: this.objectKey(id),
          Body: JSON.stringify(entry),
          ContentType: "application/json",
          IfNoneMatch: "*"
        })
      );
    } catch (error) {
      if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 412) throw error;
      const stored = await this.readEntry(this.objectKey(id), id);
      this.protectedSubjects.add(stored.subject);
      return stored;
    }
    this.protectedSubjects.add(entry.subject);
    return entry;
  }

  async list(): Promise<DeletionLedgerEntry[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: `${this.prefix}/`,
          ContinuationToken: continuationToken
        })
      );
      keys.push(...(response.Contents ?? []).flatMap((object) => (object.Key?.endsWith(".json") ? [object.Key] : [])));
      if (keys.length > maxDeletionLedgerEntries) {
        throw new Error(
          `Deletion ledger exceeds the ${maxDeletionLedgerEntries}-entry startup reconciliation bound; archive expired entries before restarting.`
        );
      }
      if (
        response.IsTruncated &&
        (typeof response.NextContinuationToken !== "string" || response.NextContinuationToken.trim().length === 0)
      ) {
        throw new Error("Deletion ledger returned a truncated page without a continuation token.");
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      if (continuationToken && seenTokens.has(continuationToken)) {
        throw new Error("Deletion ledger returned a repeated continuation token.");
      }
      if (continuationToken) seenTokens.add(continuationToken);
    } while (continuationToken);

    const sortedKeys = keys.sort();
    const entries: DeletionLedgerEntry[] = [];
    for (let offset = 0; offset < sortedKeys.length; offset += deletionLedgerReadConcurrency) {
      const batch = sortedKeys.slice(offset, offset + deletionLedgerReadConcurrency);
      entries.push(
        ...(await Promise.all(
          batch.map((key) => {
            if (!key.startsWith(`${this.prefix}/`)) {
              throw new Error("Deletion ledger returned an object outside its prefix.");
            }
            return this.readEntry(key, key.slice(this.prefix.length + 1, -5));
          })
        ))
      );
    }
    this.protectedSubjects.clear();
    for (const entry of entries) this.protectedSubjects.add(entry.subject);
    return entries;
  }

  async purgeExpired(entries?: readonly DeletionLedgerEntry[]): Promise<number> {
    entries ??= await this.list();
    const now = this.now().getTime();
    const expired = entries.filter((entry) => Date.parse(entry.protectUntil) <= now);
    for (let offset = 0; offset < expired.length; offset += deletionLedgerReadConcurrency) {
      await Promise.all(
        expired
          .slice(offset, offset + deletionLedgerReadConcurrency)
          .map((entry) =>
            this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(entry.id) }))
          )
      );
    }
    if (expired.length > 0) {
      this.protectedSubjects.clear();
      for (const entry of entries) if (Date.parse(entry.protectUntil) > now) this.protectedSubjects.add(entry.subject);
    }
    return expired.length;
  }

  private objectKey(id: string): string {
    return `${this.prefix}/${id}.json`;
  }

  private async readEntry(key: string, id: string): Promise<DeletionLedgerEntry> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!response.Body) throw new Error("Deletion ledger object has no body.");
    return parseDeletionLedgerEntry(this.options.hmacKey, await response.Body.transformToString(), id);
  }
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function createS3Client(options: S3DeletionLedgerOptions): S3Client {
  const clientConfig: S3ClientConfig = {
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.urlStyle === "path",
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 10_000 }),
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
  };
  return new S3Client(clientConfig);
}

export function deletionSubject(hmacKey: string, userId: string): string {
  return createHmac("sha256", hmacKey).update("multaiplayer-deletion-subject-v1\0").update(userId).digest("hex");
}

function createDeletionLedgerEntry(
  hmacKey: string,
  userId: string,
  requestedAt: string,
  protectionSeconds: number,
  randomId: string
): DeletionLedgerEntry {
  const subject = deletionSubject(hmacKey, userId);
  const protectUntil = new Date(Date.parse(requestedAt) + protectionSeconds * 1000).toISOString();
  const unsigned = {
    version: 1 as const,
    id: `${subject}.${Date.parse(requestedAt)}.${randomId}`,
    subject,
    requestedAt,
    protectUntil
  };
  return { ...unsigned, mac: entryMac(hmacKey, unsigned) };
}

function parseDeletionLedgerEntry(hmacKey: string, body: string, idFromKey: string): DeletionLedgerEntry {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Deletion ledger contains malformed JSON.");
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.requestedAt !== "string" ||
    typeof value.protectUntil !== "string" ||
    typeof value.mac !== "string"
  ) {
    throw new Error("Deletion ledger contains a malformed entry.");
  }
  if (
    value.id !== idFromKey ||
    !value.id.startsWith(`${value.subject}.`) ||
    !/^[a-f0-9]{64}\.[0-9]+\.[A-Za-z0-9-]{8,128}$/.test(value.id) ||
    !/^[a-f0-9]{64}$/.test(value.subject) ||
    Number.isNaN(Date.parse(value.requestedAt)) ||
    Number.isNaN(Date.parse(value.protectUntil)) ||
    Date.parse(value.protectUntil) <= Date.parse(value.requestedAt)
  ) {
    throw new Error("Deletion ledger entry identity is invalid.");
  }
  const expected = entryMac(hmacKey, {
    version: 1,
    id: value.id,
    subject: value.subject,
    requestedAt: value.requestedAt,
    protectUntil: value.protectUntil
  });
  if (!safeEqualHex(value.mac, expected)) throw new Error("Deletion ledger entry authentication failed.");
  return value as unknown as DeletionLedgerEntry;
}

function entryMac(hmacKey: string, entry: Omit<DeletionLedgerEntry, "mac">): string {
  return createHmac("sha256", hmacKey)
    .update("multaiplayer-deletion-ledger-entry-v1\0")
    .update(JSON.stringify([entry.version, entry.id, entry.subject, entry.requestedAt, entry.protectUntil]))
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

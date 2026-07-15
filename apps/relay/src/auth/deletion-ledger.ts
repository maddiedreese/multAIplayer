import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
  purgeExpired(): Promise<number>;
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
  fetchImpl?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
}

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

  async purgeExpired(): Promise<number> {
    const { unlink } = await import("node:fs/promises");
    const now = this.now().getTime();
    let purged = 0;
    for (const entry of await this.list()) {
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
    if (purged > 0) await this.list();
    return purged;
  }
}

/**
 * An append-only deletion ledger backed by an S3-compatible bucket. Objects are
 * immutable and contain no GitHub id, login, access token, or record inventory.
 */
export class S3DeletionLedger implements DeletionLedger {
  private readonly protectedSubjects = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly endpoint: URL;
  private readonly prefix: string;
  private readonly randomId: () => string;

  constructor(private readonly options: S3DeletionLedgerOptions) {
    this.endpoint = new URL(options.endpoint);
    if (this.endpoint.protocol !== "https:" && this.endpoint.hostname !== "localhost") {
      throw new Error("Deletion ledger endpoint must use HTTPS.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    const response = await this.request("PUT", this.objectPath(id), undefined, JSON.stringify(entry), {
      "content-type": "application/json",
      "if-none-match": "*"
    });
    if (response.status === 412) {
      const existing = await this.request("GET", this.objectPath(id));
      if (!existing.ok) throw new Error(`Deletion ledger idempotency read failed with status ${existing.status}.`);
      const stored = parseDeletionLedgerEntry(this.options.hmacKey, await existing.text(), id);
      this.protectedSubjects.add(stored.subject);
      return stored;
    }
    if (!response.ok) throw new Error(`Deletion ledger write failed with status ${response.status}.`);
    this.protectedSubjects.add(entry.subject);
    return entry;
  }

  async list(): Promise<DeletionLedgerEntry[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix: `${this.prefix}/` });
      if (continuationToken) query.set("continuation-token", continuationToken);
      const response = await this.request("GET", this.bucketPath(), query);
      if (!response.ok) throw new Error(`Deletion ledger listing failed with status ${response.status}.`);
      const xml = await response.text();
      keys.push(
        ...xmlElements(xml, "Key")
          .map(decodeXml)
          .filter((key) => key.endsWith(".json"))
      );
      continuationToken =
        xmlElement(xml, "IsTruncated") === "true" ? decodeXml(xmlElement(xml, "NextContinuationToken")) : undefined;
      if (continuationToken === "")
        throw new Error("Deletion ledger returned a truncated page without a continuation token.");
      if (continuationToken && seenTokens.has(continuationToken)) {
        throw new Error("Deletion ledger returned a repeated continuation token.");
      }
      if (continuationToken) seenTokens.add(continuationToken);
    } while (continuationToken);

    const entries: DeletionLedgerEntry[] = [];
    for (const key of keys.sort()) {
      if (!key.startsWith(`${this.prefix}/`)) throw new Error("Deletion ledger returned an object outside its prefix.");
      const response = await this.request("GET", this.pathForKey(key));
      if (!response.ok) throw new Error(`Deletion ledger object read failed with status ${response.status}.`);
      entries.push(
        parseDeletionLedgerEntry(this.options.hmacKey, await response.text(), key.slice(this.prefix.length + 1, -5))
      );
    }
    this.protectedSubjects.clear();
    for (const entry of entries) this.protectedSubjects.add(entry.subject);
    return entries;
  }

  async purgeExpired(): Promise<number> {
    const now = this.now().getTime();
    let purged = 0;
    for (const entry of await this.list()) {
      if (Date.parse(entry.protectUntil) > now) continue;
      const response = await this.request("DELETE", this.objectPath(entry.id));
      if (!response.ok && response.status !== 404) {
        throw new Error(`Deletion ledger expiry failed with status ${response.status}.`);
      }
      purged += 1;
    }
    if (purged > 0) await this.list();
    return purged;
  }

  private bucketPath(): string {
    return this.options.urlStyle === "path"
      ? `${this.endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(this.options.bucket)}`
      : this.endpoint.pathname.replace(/\/$/, "");
  }

  private objectPath(id: string): string {
    return this.pathForKey(`${this.prefix}/${id}.json`);
  }

  private pathForKey(key: string): string {
    return `${this.bucketPath()}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async request(
    method: string,
    path: string,
    query?: URLSearchParams,
    body = "",
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const url = new URL(this.endpoint);
    if (this.options.urlStyle === "virtual-host") url.hostname = `${this.options.bucket}.${url.hostname}`;
    url.pathname = path;
    url.search = query?.toString() ?? "";
    const timestamp = this.now();
    const amzDate = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders
    };
    const signedHeaderNames = Object.keys(headers)
      .map((key) => key.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${headers[key]!.trim()}\n`).join("");
    const canonicalQuery = Array.from(url.searchParams.entries())
      .sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      )
      .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
      .join("&");
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash
    ].join("\n");
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.options.secretAccessKey}`, date), this.options.region), "s3"),
      "aws4_request"
    );
    const signature = hmac(signingKey, stringToSign).toString("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    return this.fetchImpl(url, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(10_000)
    });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
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

function xmlElements(xml: string, name: string): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g")), (match) => match[1] ?? "");
}

function xmlElement(xml: string, name: string): string {
  return xmlElements(xml, name)[0] ?? "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

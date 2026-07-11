const encoder = new TextEncoder();

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export type CanonicalAuthenticatedValue = string | number | boolean | null;

/**
 * Deterministic canonical JSON subset for MAC and AEAD authentication data.
 *
 * Records are explicitly domain- and version-separated, sort ASCII field names,
 * accept only scalar values, and reject malformed Unicode. The format avoids
 * object insertion-order semantics and is straightforward to reproduce outside
 * JavaScript.
 */
export function canonicalAuthenticatedRecord(
  domain: string,
  version: number,
  fields: Readonly<Record<string, CanonicalAuthenticatedValue>>
): Uint8Array {
  if (!/^[a-z0-9][a-z0-9:._-]*$/.test(domain) || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Canonical authenticated records require a domain and positive integer version");
  }
  const normalized: Record<string, CanonicalAuthenticatedValue> = { domain, version };
  for (const name of Object.keys(fields)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid canonical authenticated field name: ${name}`);
    if (name === "domain" || name === "version") throw new Error(`Reserved canonical authenticated field: ${name}`);
    const value = fields[name];
    if (value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
      throw new Error(`Unsupported canonical authenticated field: ${name}`);
    }
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new Error(`Unsupported canonical authenticated field: ${name}`);
    }
    if (typeof value === "string" && !isWellFormedUnicode(value)) {
      throw new Error(`Canonical authenticated strings must be valid Unicode: ${name}`);
    }
    normalized[name] = value;
  }
  const ordered = Object.keys(normalized)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${JSON.stringify(normalized[name])}`);
  return encoder.encode(`{${ordered.join(",")}}`);
}

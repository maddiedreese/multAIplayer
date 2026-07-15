import { z } from "zod";

export const currentRelayStoreVersion = 1 as const;

const StoredRelayDocumentV1 = z
  .object({
    version: z.literal(currentRelayStoreVersion)
  })
  .passthrough();

/**
 * Version migration entry point for decoded JSON/SQLite documents.
 *
 * Version 1 predates several fields. Its row normalizers supply only the
 * documented safe defaults (for example room policy fields and legacy member
 * ids), then the persistence coordinator rewrites the normalized allowlist.
 * Future versions must add an explicit branch here rather than making a row
 * decoder silently interpret a new document shape.
 */
export function migrateStoredRelayDocument(value: unknown): Record<string, unknown> | null {
  const parsed = StoredRelayDocumentV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

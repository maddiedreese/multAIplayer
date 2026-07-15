import { normalizeMetadataText } from "./limits.js";
import type { AccountQuotaRecord, AccountRestriction, AppliedDeletionLedgerEntry, RelayStore } from "./state.js";
import {
  parseStoredRecord,
  StoredAccountQuotaRecord,
  StoredAccountRestriction,
  StoredDeletionLedgerEntry
} from "./store-codec-schemas.js";

export function normalizeAccountRestriction(
  value: unknown,
  now: number,
  maxUserIdChars: number
): AccountRestriction | null {
  const parsed = parseStoredRecord(StoredAccountRestriction, value);
  if (!parsed) return null;
  const userId = normalizeMetadataText(parsed.userId, maxUserIdChars);
  if (!userId || (parsed.expiresAt && Date.parse(parsed.expiresAt) <= now)) return null;
  return { ...parsed, userId };
}

export function normalizeAccountQuotaRecord(value: unknown, now: number): AccountQuotaRecord | null {
  const parsed = parseStoredRecord(StoredAccountQuotaRecord, value);
  return parsed && parsed.resetAt > now ? parsed : null;
}

export function normalizeDeletionLedgerEntry(value: unknown): AppliedDeletionLedgerEntry | null {
  return parseStoredRecord(StoredDeletionLedgerEntry, value);
}

export function applyStoredAccountQuotaRecords(store: RelayStore, value: unknown, now: number): void {
  for (const item of storedArray(value)) {
    const quota = normalizeAccountQuotaRecord(item, now);
    if (quota) store.accountQuotaRecords.set(quota.key, quota);
  }
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

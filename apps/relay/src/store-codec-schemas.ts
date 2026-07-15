import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const hexDigest = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Shapes owned by relay persistence rather than the public protocol package.
 * These schemas intentionally cover structure only. Runtime limits, expiry,
 * canonical crypto encodings, and cross-row references are checked by the
 * store normalizers after parsing.
 */
export const StoredInviteAckReceipt = z
  .object({
    inviteId: z.string(),
    requestId: z.string(),
    teamId: z.string(),
    requesterUserId: z.string(),
    requesterDeviceId: z.string(),
    keyPackageHash: sha256Digest,
    status: z.enum(["approved", "denied"]),
    acknowledgedAt: isoDateTime,
    expiresAt: isoDateTime
  })
  .strip();

export const StoredAcceptedMessageReceipt = z
  .object({
    roomKey: z.string(),
    messageId: z.string(),
    messageType: z.enum(["application", "commit"]),
    senderUserId: z.string(),
    senderDeviceId: z.string(),
    parentEpoch: z.number().int().nonnegative(),
    digest: hexDigest,
    acceptedAt: isoDateTime
  })
  .strip();

export const StoredAccountRestriction = z
  .object({
    userId: z.string(),
    reasonCode: z.string().regex(/^[a-z0-9_]{1,64}$/),
    createdAt: isoDateTime,
    expiresAt: isoDateTime.optional()
  })
  .strip();

export const StoredAccountQuotaRecord = z
  .object({
    key: z.string(),
    userId: z.string(),
    quota: z.enum(["daily_team_creations", "daily_room_creations", "attachment_upload_bytes"]),
    used: z.number().int().nonnegative(),
    resetAt: z.number().int().nonnegative()
  })
  .strip()
  .superRefine((value, context) => {
    if (value.key !== `${value.quota}:${value.userId}`) {
      context.addIssue({ code: "custom", path: ["key"], message: "Quota key must bind quota and user." });
    }
  });

export const StoredDeletionLedgerEntry = z
  .object({
    entryId: z.string().min(1).max(512),
    appliedAt: isoDateTime
  })
  .strip();

export const StoredTeamMembers = z
  .object({
    teamId: z.string(),
    members: z.array(z.unknown()).optional(),
    userIds: z.array(z.unknown()).optional()
  })
  .strip();

export const StoredMlsBacklog = z
  .object({
    key: z.string(),
    messages: z.array(z.unknown())
  })
  .strip();

export function parseStoredRecord<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

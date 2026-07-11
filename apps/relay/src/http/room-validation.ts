import type { Response } from "express";
import { codexSandboxLevelOptions, type CodexCatalogSelectionPolicy, type RoomRecord } from "@multaiplayer/protocol";
import type { RelayStore } from "../state.js";

export function normalizeCatalogSelectionPolicy(
  value: unknown,
  fallback?: CodexCatalogSelectionPolicy
): CodexCatalogSelectionPolicy | undefined | null {
  if (value === undefined) return fallback;
  return value === "auto" || value === "pinned" ? value : null;
}

export function normalizeCodexSandboxLevel(value: unknown): RoomRecord["codexSandboxLevel"] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return codexSandboxLevelOptions.some((option) => option.id === trimmed)
    ? (trimmed as RoomRecord["codexSandboxLevel"])
    : null;
}

export function normalizeTrustedApproverUserIds(value: unknown, maxUserIdChars: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || normalized.length > maxUserIdChars || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    ids.add(normalized);
  }
  return [...ids];
}

export function allowTotalRoomQuota({
  store,
  teamIds,
  cap,
  res,
  recordQuotaRejection
}: {
  store: RelayStore;
  teamIds: Set<string>;
  cap: number;
  res: Response;
  recordQuotaRejection?: (type: string) => void;
}): boolean {
  const quota = "total_user_rooms";
  const used = store.allRooms().filter((room) => teamIds.has(room.teamId) && !room.deletedAt).length;
  if (used < cap) return true;
  recordQuotaRejection?.(quota);
  res.status(429).json({
    error: "Total room quota exceeded.",
    code: "quota_exceeded",
    quota: { type: quota, limit: cap, used, remaining: 0 }
  });
  return false;
}

export interface DailyCreationQuotaRecord {
  count: number;
  resetAt: number;
}

export function consumeDailyCreationQuota({
  cap,
  counts,
  quota,
  userId,
  res,
  recordQuotaRejection
}: {
  cap: number;
  counts: Map<string, DailyCreationQuotaRecord>;
  quota: "daily_user_room_creations";
  userId: string;
  res: Response;
  recordQuotaRejection?: (type: string) => void;
}): boolean {
  const now = Date.now();
  const resetAt = nextUtcMidnight(now);
  const key = `${quota}:${userId}`;
  const current = counts.get(key);
  const record = current && current.resetAt > now ? current : { count: 0, resetAt };
  if (record.count >= cap) {
    sendDailyCreationQuotaExceeded(res, { quota, limit: cap, used: record.count, resetAt: record.resetAt });
    recordQuotaRejection?.(quota);
    return false;
  }
  counts.set(key, { count: record.count + 1, resetAt: record.resetAt });
  return true;
}

function sendDailyCreationQuotaExceeded(
  res: Response,
  options: { quota: "daily_user_room_creations"; limit: number; used: number; resetAt: number }
) {
  const { quota, limit, used, resetAt } = options;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  res.status(429).json({
    error: "Daily room creation quota exceeded.",
    code: "quota_exceeded",
    retryAfterSeconds,
    quota: { type: quota, limit, used, remaining: 0, resetsAt: new Date(resetAt).toISOString() }
  });
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

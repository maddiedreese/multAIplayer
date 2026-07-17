import { sendRelayError } from "./errors.js";
import type { Response } from "express";
import type { RelayStore } from "../state.js";

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
  recordQuotaRejection?: ((type: string) => void) | undefined;
}): boolean {
  const quota = "total_user_rooms";
  const used = store.allRooms().filter((room) => teamIds.has(room.teamId) && !room.deletedAt).length;
  if (used < cap) return true;
  recordQuotaRejection?.(quota);
  sendRelayError(res, 429, "quota_exceeded", "Total room quota exceeded.", {
    quota: { type: quota, limit: cap, used, remaining: 0 }
  });
  return false;
}

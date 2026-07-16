import { invokeNative } from "../platform/nativeCommandError";
import { createMlsGroup, setMlsHistoryRetention } from "../mls/mlsClient";
import { reportNonFatal } from "../core/nonFatalReporting";
import { LocalHistoryWriteQueue } from "./localHistoryWriteQueue";
import { runRoomLocalDataCleanup } from "../core/roomLocalDataCleanup";

const defaultRetentionDays = 30;

export interface LocalHistorySettings {
  enabled: boolean;
  retentionDays: number;
}

export async function loadEncryptedHistory<T>(roomId: string): Promise<T | null> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) return null;
  const encoded = await invokeNative<string | null>("mls_history_load_latest", { request: { roomId } });
  if (!encoded) return null;
  return JSON.parse(decodeUtf8(encoded)) as T;
}

export async function saveEncryptedHistory(roomId: string, value: unknown): Promise<void> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) {
    await deleteEncryptedHistoryNow(roomId);
    return;
  }
  await invokeNative<number>("mls_history_save", {
    request: { roomId, plaintext: encodeUtf8(JSON.stringify(value)), retentionDays: settings.retentionDays }
  });
}

export async function clearEncryptedHistory(roomId: string): Promise<void> {
  await historyWriteQueue.withBarrier(roomId, () => deleteEncryptedHistoryNow(roomId));
}

export async function forgetRoomLocalData(roomId: string): Promise<void> {
  await runRoomLocalDataCleanup(roomId, () =>
    historyWriteQueue.withBarrier(roomId, async () => {
      await invokeNative("mls_room_local_data_delete", { request: { roomId } });
      localStorage.removeItem(settingsKey(roomId));
    })
  );
}

const historyWriteQueue = new LocalHistoryWriteQueue(saveEncryptedHistory);

/** Serializes each room's native writes and coalesces bursts to the newest snapshot. */
export function queueEncryptedHistorySave(
  roomId: string,
  value: unknown,
  onError: (error: unknown) => void,
  onSuccess?: () => void
): void {
  historyWriteQueue.queue(roomId, value, onError, onSuccess);
}

export async function flushEncryptedHistorySaves(roomId?: string): Promise<void> {
  await historyWriteQueue.flush(roomId);
}

async function deleteEncryptedHistoryNow(roomId: string): Promise<void> {
  await invokeNative("mls_history_delete_all", { request: { roomId } });
}

export function loadHistorySettings(roomId: string): LocalHistorySettings {
  return readSettings(settingsKey(roomId));
}

export function hasHistorySettings(roomId: string): boolean {
  return localStorage.getItem(settingsKey(roomId)) !== null;
}

export async function saveHistorySettings(
  roomId: string,
  settings: LocalHistorySettings
): Promise<LocalHistorySettings> {
  const normalized = sanitizeHistorySettings(settings);
  if (!normalized.enabled) await clearEncryptedHistory(roomId);
  else await setMlsHistoryRetention(roomId, normalized.retentionDays);
  return persistHistorySettings(roomId, normalized);
}

export function seedNewRoomHistorySettings(roomId: string, settings: LocalHistorySettings): LocalHistorySettings {
  // A relay room exists before its native MLS group. Persist only the
  // non-secret preference here; applying retention before group creation is
  // both unnecessary for a new room and rejected by the native core.
  return persistHistorySettings(roomId, sanitizeHistorySettings(settings));
}

export async function applyHistorySettingsToMlsGroup(roomId: string): Promise<LocalHistorySettings> {
  return saveHistorySettings(roomId, loadHistorySettings(roomId));
}

export async function createMlsGroupWithHistorySettings(roomId: string): Promise<void> {
  await createMlsGroup(roomId);
  await applyHistorySettingsToMlsGroup(roomId);
}

function persistHistorySettings(roomId: string, normalized: LocalHistorySettings): LocalHistorySettings {
  localStorage.setItem(settingsKey(roomId), JSON.stringify(normalized));
  return normalized;
}

export function loadTeamHistorySettings(teamId: string): LocalHistorySettings {
  return readSettings(teamSettingsKey(teamId));
}

export function saveTeamHistorySettings(teamId: string, settings: LocalHistorySettings): LocalHistorySettings {
  const normalized = sanitizeHistorySettings(settings);
  localStorage.setItem(teamSettingsKey(teamId), JSON.stringify(normalized));
  return normalized;
}

function readSettings(key: string): LocalHistorySettings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<LocalHistorySettings> | null;
    return sanitizeHistorySettings(stored ?? {});
  } catch {
    reportNonFatal("discard corrupt local-history settings");
    localStorage.removeItem(key);
    return sanitizeHistorySettings({});
  }
}

function sanitizeHistorySettings(settings: Partial<LocalHistorySettings>): LocalHistorySettings {
  const retentionDays = Number.isFinite(settings.retentionDays)
    ? Math.round(Number(settings.retentionDays))
    : defaultRetentionDays;
  return { enabled: settings.enabled !== false, retentionDays: Math.min(365, Math.max(1, retentionDays)) };
}

function settingsKey(roomId: string): string {
  return `multaiplayer:history-settings:${roomId}`;
}

function teamSettingsKey(teamId: string): string {
  return `multaiplayer:team-history-settings:${teamId}`;
}

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUtf8(value: string): string {
  const binary = atob(value);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

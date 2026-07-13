import { invoke } from "@tauri-apps/api/core";
import { setMlsHistoryRetention } from "./mlsClient";
import { reportNonFatal } from "./nonFatalReporting";

const defaultRetentionDays = 30;

export interface LocalHistorySettings {
  enabled: boolean;
  retentionDays: number;
}

export async function loadEncryptedHistory<T>(roomId: string): Promise<T | null> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) return null;
  const encoded = await invoke<string | null>("mls_history_load_latest", { request: { roomId } });
  if (!encoded) return null;
  return JSON.parse(decodeUtf8(encoded)) as T;
}

export async function saveEncryptedHistory(roomId: string, value: unknown): Promise<void> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) {
    await clearEncryptedHistory(roomId);
    return;
  }
  await invoke<number>("mls_history_save", {
    request: { roomId, plaintext: encodeUtf8(JSON.stringify(value)), retentionDays: settings.retentionDays }
  });
}

export async function clearEncryptedHistory(roomId: string): Promise<void> {
  await invoke("mls_history_delete_all", { request: { roomId } });
}

export async function forgetRoomLocalData(roomId: string): Promise<void> {
  await clearEncryptedHistory(roomId);
  localStorage.removeItem(settingsKey(roomId));
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

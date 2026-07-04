import { createRoomSecret, decryptJson, encryptJson, type RoomSecret } from "@multaiplayer/crypto";
import { invoke } from "@tauri-apps/api/core";

const defaultRetentionDays = 30;

export interface LocalHistorySettings {
  enabled: boolean;
  retentionDays: number;
}

interface StoredHistory {
  savedAt: string;
  ciphertext: Awaited<ReturnType<typeof encryptJson>>;
}

export async function loadEncryptedHistory<T>(roomId: string): Promise<T | null> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) return null;
  const stored = readStoredHistory(roomId);
  if (!stored) return null;
  const secret = await loadRoomSecret(roomId);
  if (!secret) return null;

  const savedAt = new Date(stored.savedAt);
  const expiresAt = new Date(savedAt);
  expiresAt.setDate(expiresAt.getDate() + settings.retentionDays);
  if (expiresAt < new Date()) {
    localStorage.removeItem(historyKey(roomId));
    return null;
  }

  return decryptJson<T>(stored.ciphertext, secret);
}

export async function saveEncryptedHistory(roomId: string, value: unknown): Promise<void> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) {
    localStorage.removeItem(historyKey(roomId));
    return;
  }
  const secret = await loadOrCreateRoomSecret(roomId);
  const ciphertext = await encryptJson(value, secret);
  const stored: StoredHistory = {
    savedAt: new Date().toISOString(),
    ciphertext
  };
  localStorage.setItem(historyKey(roomId), JSON.stringify(stored));
}

export async function clearEncryptedHistory(roomId: string): Promise<void> {
  localStorage.removeItem(historyKey(roomId));
}

export async function forgetRoomLocalData(roomId: string): Promise<void> {
  localStorage.removeItem(historyKey(roomId));
  localStorage.removeItem(settingsKey(roomId));
  localStorage.removeItem(secretKey(roomId));
  await deleteNativeRoomSecret(roomId);
}

export function loadHistorySettings(roomId: string): LocalHistorySettings {
  const stored = localStorage.getItem(settingsKey(roomId));
  if (!stored) return { enabled: true, retentionDays: defaultRetentionDays };
  try {
    return sanitizeHistorySettings(JSON.parse(stored) as Partial<LocalHistorySettings>);
  } catch {
    localStorage.removeItem(settingsKey(roomId));
    return { enabled: true, retentionDays: defaultRetentionDays };
  }
}

export function hasHistorySettings(roomId: string): boolean {
  return localStorage.getItem(settingsKey(roomId)) !== null;
}

export function saveHistorySettings(roomId: string, settings: LocalHistorySettings): LocalHistorySettings {
  const sanitized = sanitizeHistorySettings(settings);
  localStorage.setItem(settingsKey(roomId), JSON.stringify(sanitized));
  if (!sanitized.enabled) {
    localStorage.removeItem(historyKey(roomId));
  }
  return sanitized;
}

export function loadTeamHistorySettings(teamId: string): LocalHistorySettings {
  const stored = localStorage.getItem(teamSettingsKey(teamId));
  if (!stored) return { enabled: true, retentionDays: defaultRetentionDays };
  try {
    return sanitizeHistorySettings(JSON.parse(stored) as Partial<LocalHistorySettings>);
  } catch {
    localStorage.removeItem(teamSettingsKey(teamId));
    return { enabled: true, retentionDays: defaultRetentionDays };
  }
}

export function saveTeamHistorySettings(teamId: string, settings: LocalHistorySettings): LocalHistorySettings {
  const sanitized = sanitizeHistorySettings(settings);
  localStorage.setItem(teamSettingsKey(teamId), JSON.stringify(sanitized));
  return sanitized;
}

export async function loadOrCreateRoomSecret(roomId: string): Promise<RoomSecret> {
  const existing = await loadRoomSecret(roomId);
  if (existing) return existing;

  const secret = await createRoomSecret();
  await writeNativeRoomSecret(roomId, secret);
  return secret;
}

export async function loadRoomSecret(roomId: string): Promise<RoomSecret | null> {
  const nativeSecret = await readNativeRoomSecret(roomId);
  if (nativeSecret) return nativeSecret;

  const stored = localStorage.getItem(secretKey(roomId));
  if (stored) {
    const parsed = JSON.parse(stored) as RoomSecret;
    await writeNativeRoomSecret(roomId, parsed);
    if (isTauriRuntime()) localStorage.removeItem(secretKey(roomId));
    return parsed;
  }

  return null;
}

export async function exportRoomSecret(roomId: string): Promise<RoomSecret> {
  return loadOrCreateRoomSecret(roomId);
}

export async function importRoomSecret(roomId: string, secret: RoomSecret): Promise<void> {
  await writeNativeRoomSecret(roomId, secret);
}

export async function replaceRoomSecret(roomId: string, secret: RoomSecret): Promise<void> {
  await writeNativeRoomSecret(roomId, secret);
  localStorage.removeItem(historyKey(roomId));
}

function readStoredHistory(roomId: string): StoredHistory | null {
  const stored = localStorage.getItem(historyKey(roomId));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as StoredHistory;
  } catch {
    localStorage.removeItem(historyKey(roomId));
    return null;
  }
}

function historyKey(roomId: string): string {
  return `multaiplayer:history:${roomId}`;
}

function settingsKey(roomId: string): string {
  return `multaiplayer:history-settings:${roomId}`;
}

function teamSettingsKey(teamId: string): string {
  return `multaiplayer:team-history-settings:${teamId}`;
}

function secretKey(roomId: string): string {
  return `multaiplayer:room-secret:${roomId}`;
}

async function readNativeRoomSecret(roomId: string): Promise<RoomSecret | null> {
  if (!isTauriRuntime()) return null;
  const stored = await invoke<string | null>("room_secret_get", { roomId });
  return stored ? JSON.parse(stored) as RoomSecret : null;
}

async function writeNativeRoomSecret(roomId: string, secret: RoomSecret): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(secretKey(roomId), JSON.stringify(secret));
    return;
  }
  await invoke("room_secret_set", {
    request: {
      roomId,
      secret: JSON.stringify(secret)
    }
  });
}

async function deleteNativeRoomSecret(roomId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("room_secret_delete", { roomId });
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function sanitizeHistorySettings(settings: Partial<LocalHistorySettings>): LocalHistorySettings {
  const retentionDays = Number.isFinite(settings.retentionDays)
    ? Math.round(Number(settings.retentionDays))
    : defaultRetentionDays;
  return {
    enabled: settings.enabled !== false,
    retentionDays: Math.min(365, Math.max(1, retentionDays))
  };
}

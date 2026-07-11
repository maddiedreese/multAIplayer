import {
  createRoomSecret,
  decryptLocalJson,
  encryptLocalJson,
  validateRoomSecret,
  type RoomSecret
} from "@multaiplayer/crypto";
import {
  CiphertextPayload,
  RelayEnvelope,
  RoomKeyRotationPlaintextPayload,
  type RelayEnvelope as RelayEnvelopeType,
  type RoomKeyRotationPlaintextPayload as RoomKeyRotationPayloadType
} from "@multaiplayer/protocol";
import { invoke } from "@tauri-apps/api/core";

const defaultRetentionDays = 30;
const knownCurrentEpochs = new Map<string, number>();
const webPreviewRoomKeyrings = new Map<string, RoomKeyring>();

export interface LocalHistorySettings {
  enabled: boolean;
  retentionDays: number;
}

interface StoredHistory {
  savedAt: string;
  keyEpoch: number;
  ciphertext: Awaited<ReturnType<typeof encryptLocalJson>>;
}

export interface RoomKeyring {
  version: 2;
  currentEpoch: number;
  keys: Record<string, RoomSecret>;
  pendingRotation?: PendingRoomKeyRotation;
}

export interface PendingRoomKeyRotation {
  envelope: RelayEnvelopeType;
  payload: RoomKeyRotationPayloadType;
  newSecret: RoomSecret;
  installed: boolean;
}

export async function loadEncryptedHistory<T>(roomId: string): Promise<T | null> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) return null;
  const stored = readStoredHistory(roomId);
  if (!stored) return null;
  const secret = await loadRoomSecret(roomId, stored.keyEpoch);
  if (!secret) return null;

  const savedAt = new Date(stored.savedAt);
  const expiresAt = new Date(savedAt);
  expiresAt.setDate(expiresAt.getDate() + settings.retentionDays);
  if (expiresAt < new Date()) {
    localStorage.removeItem(historyKey(roomId));
    await pruneRoomKeyring(roomId);
    return null;
  }

  try {
    return await decryptLocalJson<T>(stored.ciphertext, secret, {
      purpose: "room-history",
      roomId,
      keyEpoch: stored.keyEpoch,
      savedAt: stored.savedAt
    });
  } catch {
    localStorage.removeItem(historyKey(roomId));
    return null;
  }
}

export async function saveEncryptedHistory(roomId: string, value: unknown): Promise<void> {
  const settings = loadHistorySettings(roomId);
  if (!settings.enabled) {
    localStorage.removeItem(historyKey(roomId));
    return;
  }
  const { epoch, secret } = await loadOrCreateCurrentRoomKey(roomId);
  const savedAt = new Date().toISOString();
  const ciphertext = await encryptLocalJson(value, secret, {
    purpose: "room-history",
    roomId,
    keyEpoch: epoch,
    savedAt
  });
  const stored: StoredHistory = {
    savedAt,
    keyEpoch: epoch,
    ciphertext
  };
  localStorage.setItem(historyKey(roomId), JSON.stringify(stored));
  await pruneRoomKeyring(roomId);
}

export async function clearEncryptedHistory(roomId: string): Promise<void> {
  localStorage.removeItem(historyKey(roomId));
  await pruneRoomKeyring(roomId);
}

export async function forgetRoomLocalData(roomId: string): Promise<void> {
  knownCurrentEpochs.delete(roomId);
  webPreviewRoomKeyrings.delete(roomId);
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
  return (await loadOrCreateCurrentRoomKey(roomId)).secret;
}

export async function loadOrCreateCurrentRoomKey(roomId: string): Promise<{ epoch: number; secret: RoomSecret }> {
  const existing = await loadRoomKeyring(roomId);
  if (existing) {
    knownCurrentEpochs.set(roomId, existing.currentEpoch);
    return { epoch: existing.currentEpoch, secret: existing.keys[String(existing.currentEpoch)]! };
  }
  const secret = await createRoomSecret();
  const keyring: RoomKeyring = { version: 2, currentEpoch: 1, keys: { "1": secret } };
  await writeRoomKeyring(roomId, keyring);
  knownCurrentEpochs.set(roomId, 1);
  return { epoch: 1, secret };
}

export function knownCurrentRoomKeyEpoch(roomId: string): number {
  return knownCurrentEpochs.get(roomId) ?? 1;
}

export async function loadRoomSecret(roomId: string, epoch?: number): Promise<RoomSecret | null> {
  const keyring = await loadRoomKeyring(roomId);
  if (!keyring) return null;
  return keyring.keys[String(epoch ?? keyring.currentEpoch)] ?? null;
}

export async function loadRoomKeyring(roomId: string): Promise<RoomKeyring | null> {
  const stored = await readStoredRoomKeyMaterial(roomId);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    const keyring = parseRoomKeyring(parsed);
    if (keyring) {
      knownCurrentEpochs.set(roomId, keyring.currentEpoch);
      return keyring;
    }
    validateRoomSecret(parsed);
    const migrated: RoomKeyring = { version: 2, currentEpoch: 1, keys: { "1": parsed } };
    await writeRoomKeyring(roomId, migrated);
    knownCurrentEpochs.set(roomId, 1);
    return migrated;
  } catch {
    localStorage.removeItem(secretKey(roomId));
    await deleteNativeRoomSecret(roomId);
    return null;
  }
}

export async function exportRoomSecret(roomId: string): Promise<RoomSecret> {
  return loadOrCreateRoomSecret(roomId);
}

export async function importRoomSecret(roomId: string, secret: RoomSecret, epoch = 1): Promise<void> {
  validateRoomSecret(secret);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("Room key epoch must be a positive integer");
  await writeRoomKeyring(roomId, { version: 2, currentEpoch: epoch, keys: { [String(epoch)]: secret } });
  knownCurrentEpochs.set(roomId, epoch);
}

export async function replaceRoomSecret(roomId: string, secret: RoomSecret): Promise<void> {
  validateRoomSecret(secret);
  const current = await loadRoomKeyring(roomId);
  const nextEpoch = (current?.currentEpoch ?? 0) + 1;
  await installRoomSecretEpoch(roomId, nextEpoch, secret);
  localStorage.removeItem(historyKey(roomId));
}

export async function installRoomSecretEpoch(roomId: string, epoch: number, secret: RoomSecret): Promise<void> {
  validateRoomSecret(secret);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("Room key epoch must be a positive integer");
  const current = await loadRoomKeyring(roomId);
  if (current && epoch === current.currentEpoch) {
    const installed = current.keys[String(epoch)];
    if (installed?.algorithm === secret.algorithm && installed.rawKey === secret.rawKey) return;
    throw new Error(`Room key epoch ${epoch} is already installed with different key material`);
  }
  if (current && epoch !== current.currentEpoch + 1) {
    throw new Error(`Room key epoch ${epoch} does not immediately follow ${current.currentEpoch}`);
  }
  await writeRoomKeyring(roomId, {
    version: 2,
    currentEpoch: epoch,
    keys: { ...(current?.keys ?? {}), [String(epoch)]: secret },
    pendingRotation: current?.pendingRotation
  });
  knownCurrentEpochs.set(roomId, epoch);
  await pruneRoomKeyring(roomId);
}

export async function loadPendingRoomRotation(roomId: string): Promise<PendingRoomKeyRotation | null> {
  return (await loadRoomKeyring(roomId))?.pendingRotation ?? null;
}

export async function savePendingRoomRotation(roomId: string, pendingRotation: PendingRoomKeyRotation): Promise<void> {
  const current = await loadRoomKeyring(roomId);
  if (!current) throw new Error("Cannot journal a rotation without an existing room keyring");
  validatePendingRoomRotation(pendingRotation);
  if (pendingRotation.envelope.roomId !== roomId) throw new Error("Pending rotation room binding does not match");
  await writeRoomKeyring(roomId, { ...current, pendingRotation });
}

export async function clearPendingRoomRotation(roomId: string, rotationId: string): Promise<void> {
  const current = await loadRoomKeyring(roomId);
  if (!current?.pendingRotation || current.pendingRotation.payload.id !== rotationId) return;
  const { pendingRotation: _removed, ...withoutPending } = current;
  await writeRoomKeyring(roomId, withoutPending);
  await pruneRoomKeyring(roomId);
}

async function pruneRoomKeyring(roomId: string): Promise<void> {
  const current = await loadRoomKeyring(roomId);
  if (!current) return;
  const retainedEpochs = new Set([current.currentEpoch]);
  const history = readStoredHistory(roomId);
  if (history) retainedEpochs.add(history.keyEpoch);
  if (current.pendingRotation) {
    retainedEpochs.add(current.pendingRotation.envelope.keyEpoch);
    if (current.pendingRotation.installed) retainedEpochs.add(current.pendingRotation.payload.newEpoch);
  }
  const keys = Object.fromEntries(Object.entries(current.keys).filter(([epoch]) => retainedEpochs.has(Number(epoch))));
  if (Object.keys(keys).length !== Object.keys(current.keys).length) {
    await writeRoomKeyring(roomId, { ...current, keys });
  }
}

function readStoredHistory(roomId: string): StoredHistory | null {
  const stored = localStorage.getItem(historyKey(roomId));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!isStoredHistory(parsed)) throw new Error("invalid stored encrypted history");
    return parsed;
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

async function readStoredRoomKeyMaterial(roomId: string): Promise<string | null> {
  if (isTauriRuntime()) {
    const native = await invoke<string | null>("room_secret_get", { roomId });
    if (native) return native;
  }
  const memoryKeyring = webPreviewRoomKeyrings.get(roomId);
  if (memoryKeyring) return JSON.stringify(memoryKeyring);
  const legacy = localStorage.getItem(secretKey(roomId));
  if (legacy) localStorage.removeItem(secretKey(roomId));
  return legacy;
}

async function writeRoomKeyring(roomId: string, keyring: RoomKeyring): Promise<void> {
  const serialized = JSON.stringify(keyring);
  if (!isTauriRuntime()) {
    webPreviewRoomKeyrings.set(roomId, JSON.parse(serialized) as RoomKeyring);
    localStorage.removeItem(secretKey(roomId));
    return;
  }
  await invoke("room_secret_set", {
    request: {
      roomId,
      secret: serialized
    }
  });
  localStorage.removeItem(secretKey(roomId));
}

export function clearWebPreviewRoomKeyringsForTests(): void {
  webPreviewRoomKeyrings.clear();
  knownCurrentEpochs.clear();
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

function isStoredHistory(value: unknown): value is StoredHistory {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredHistory>;
  if (
    typeof record.savedAt !== "string" ||
    Number.isNaN(Date.parse(record.savedAt)) ||
    !Number.isSafeInteger(record.keyEpoch) ||
    Number(record.keyEpoch) < 1
  )
    return false;
  return CiphertextPayload.safeParse(record.ciphertext).success;
}

function parseRoomKeyring(value: unknown): RoomKeyring | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RoomKeyring>;
  if (record.version !== 2 || !Number.isSafeInteger(record.currentEpoch) || Number(record.currentEpoch) < 1)
    return null;
  if (!record.keys || typeof record.keys !== "object") return null;
  const keys: Record<string, RoomSecret> = {};
  for (const [epoch, secret] of Object.entries(record.keys)) {
    if (!/^[1-9]\d*$/.test(epoch)) return null;
    validateRoomSecret(secret);
    keys[epoch] = secret;
  }
  if (!keys[String(record.currentEpoch)]) return null;
  let pendingRotation: PendingRoomKeyRotation | undefined;
  if (record.pendingRotation !== undefined) {
    validatePendingRoomRotation(record.pendingRotation);
    pendingRotation = record.pendingRotation;
  }
  return pendingRotation
    ? { version: 2, currentEpoch: Number(record.currentEpoch), keys, pendingRotation }
    : { version: 2, currentEpoch: Number(record.currentEpoch), keys };
}

function validatePendingRoomRotation(value: unknown): asserts value is PendingRoomKeyRotation {
  if (!value || typeof value !== "object") throw new Error("Invalid pending room rotation");
  const record = value as Partial<PendingRoomKeyRotation>;
  const envelope = RelayEnvelope.safeParse(record.envelope);
  const payload = RoomKeyRotationPlaintextPayload.safeParse(record.payload);
  if (!envelope.success || !payload.success || envelope.data.roomId === "" || payload.data.id === "") {
    throw new Error("Invalid pending room rotation payload");
  }
  validateRoomSecret(record.newSecret);
  if (typeof record.installed !== "boolean") throw new Error("Invalid pending room rotation phase");
}

import { open, save } from "@tauri-apps/plugin-dialog";
import { invokeNative } from "../nativeCommandError";
import { isTauriRuntime } from "./runtime";

export interface RoomArchiveBody {
  version: 1;
  exportedAt: string;
  source: { roomName: string; teamName?: string };
  omissions: string[];
  history: RoomArchiveHistory;
}

export interface RoomArchiveHistory {
  version: 1;
  messages: unknown[];
  chatEdits: unknown[];
  chatDeletes: unknown[];
  terminalRequests: unknown[];
  fileSaveRequests: unknown[];
  browserRequests: unknown[];
  codexEvents: unknown[];
  codexActivities: unknown[];
  gitWorkflowEvents: unknown[];
  githubActionsEvents: unknown[];
  localPreviews: unknown[];
  terminalSnapshots: unknown[];
  roomGoal?: unknown;
}

export interface RoomArchiveLibraryEntry {
  id: string;
  importedAt: string;
  byteLength: number;
  version: 1;
}

export interface OpenedRoomArchive {
  entry: RoomArchiveLibraryEntry;
  archive: RoomArchiveBody;
}

export async function chooseRoomArchiveExportPath(roomName: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const safeName = roomName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "room";
  const selected = await save({
    defaultPath: `${safeName}.multai.age`,
    filters: [{ name: "Encrypted multAIplayer room archive", extensions: ["age"] }]
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseRoomArchiveImportPath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Encrypted multAIplayer room archive", extensions: ["age"] }]
  });
  return typeof selected === "string" ? selected : null;
}

export async function exportRoomArchive(
  path: string,
  passphrase: string,
  archive: RoomArchiveBody
): Promise<RoomArchiveLibraryEntry> {
  return invokeNative("room_archive_export", { request: { path, passphrase, archive } });
}

export async function importRoomArchive(path: string, passphrase: string): Promise<OpenedRoomArchive> {
  return invokeNative("room_archive_import", { request: { path, passphrase } });
}

export async function listRoomArchives(): Promise<RoomArchiveLibraryEntry[]> {
  if (!isTauriRuntime()) return [];
  return invokeNative("room_archive_list");
}

export async function openRoomArchive(archiveId: string, passphrase: string): Promise<OpenedRoomArchive> {
  return invokeNative("room_archive_open", { request: { archiveId, passphrase } });
}

export async function deleteRoomArchive(archiveId: string): Promise<void> {
  return invokeNative("room_archive_delete", { request: { archiveId } });
}

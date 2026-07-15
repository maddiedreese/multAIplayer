import { useCallback, useEffect, useState } from "react";
import { Archive, Download, Eye, Trash2, Upload } from "lucide-react";
import {
  chooseRoomArchiveExportPath,
  chooseRoomArchiveImportPath,
  deleteRoomArchive,
  exportRoomArchive,
  importRoomArchive,
  listRoomArchives,
  openRoomArchive,
  type RoomArchiveLibraryEntry
} from "../lib/platform/localBackend";
import {
  buildReadOnlyRoomArchive,
  projectReadOnlyRoomArchive,
  type ReadOnlyRoomArchiveProjection
} from "../application/history/roomArchive";
import { reportNonFatal } from "../lib/core/nonFatalReporting";
import { useAppStore } from "../store/appStore";

export function RoomArchivePanel({
  selectedRoomId,
  selectedRoomName,
  hasSelectedRoom
}: {
  selectedRoomId: string;
  selectedRoomName: string;
  hasSelectedRoom: boolean;
}) {
  const [entries, setEntries] = useState<RoomArchiveLibraryEntry[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [opened, setOpened] = useState<ReadOnlyRoomArchiveProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listRoomArchives());
    } catch (error) {
      reportNonFatal("list encrypted room archives", error);
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      reportNonFatal("manage encrypted room archive", error);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const exportSelected = () =>
    run(async () => {
      if (!hasSelectedRoom) throw new Error("Select a live room to export.");
      if (passphrase !== confirmation) throw new Error("The archive passphrases do not match.");
      const path = await chooseRoomArchiveExportPath(selectedRoomName);
      if (!path) return;
      const state = useAppStore.getState();
      const teamName = state.teams.find((team) => team.id === state.selectedTeam)?.name;
      const archive = buildReadOnlyRoomArchive(state, selectedRoomId, selectedRoomName, teamName);
      await exportRoomArchive(path, passphrase, archive);
      setConfirmation("");
      setMessage("Encrypted read-only archive exported. Keep its passphrase separately.");
    });

  const importSelected = () =>
    run(async () => {
      const path = await chooseRoomArchiveImportPath();
      if (!path) return;
      const result = await importRoomArchive(path, passphrase);
      setOpened(projectReadOnlyRoomArchive(result.archive));
      await refresh();
      setMessage("Archive imported into the encrypted, read-only archive library.");
    });

  const openSelected = (entry: RoomArchiveLibraryEntry) =>
    run(async () => {
      const result = await openRoomArchive(entry.id, passphrase);
      setOpened(projectReadOnlyRoomArchive(result.archive));
      setMessage("Archive decrypted for this view only. It was not joined to a live room.");
    });

  const deleteSelected = (entry: RoomArchiveLibraryEntry) =>
    run(async () => {
      if (!window.confirm("Delete this imported encrypted archive from this device?")) return;
      await deleteRoomArchive(entry.id);
      setOpened(null);
      await refresh();
      setMessage("Imported archive deleted.");
    });

  const passwordValid = new TextEncoder().encode(passphrase).length >= 12;
  return (
    <section className="drawer-section room-archive-panel">
      <div className="drawer-section-title">
        <Archive size={15} /> Encrypted room archives
      </div>
      <p className="drawer-help-text">
        Export display history with an age passphrase, or open an imported archive read-only. Archives never restore
        membership, host authority, approvals, MLS keys, device secrets, or executable pending work.
      </p>
      <label>
        <span>Archive passphrase (12+ bytes)</span>
        <input
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
      </label>
      <label>
        <span>Confirm for export</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <div className="drawer-button-row">
        <button className="primary-wide" disabled={busy || !hasSelectedRoom || !passwordValid} onClick={exportSelected}>
          <Download size={15} /> Export selected room
        </button>
        <button className="ghost-wide" disabled={busy || !passwordValid} onClick={importSelected}>
          <Upload size={15} /> Import archive
        </button>
      </div>
      <div className="archive-library-list" aria-label="Imported encrypted archives">
        {entries.length === 0 && <small>No imported archives on this device.</small>}
        {entries.map((entry) => (
          <div className="archive-library-row" key={entry.id}>
            <div>
              <strong>Locked archive</strong>
              <small>
                Imported {new Date(entry.importedAt).toLocaleString()} · {formatBytes(entry.byteLength)}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Open read-only archive"
              disabled={busy || !passwordValid}
              onClick={() => openSelected(entry)}
            >
              <Eye size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Delete imported archive"
              disabled={busy}
              onClick={() => deleteSelected(entry)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {opened && <ReadOnlyArchiveView archive={opened} />}
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}

function ReadOnlyArchiveView({ archive }: { archive: ReadOnlyRoomArchiveProjection }) {
  const history = archive.history;
  const activityCount =
    history.terminalRequests.length +
    history.fileSaveRequests.length +
    history.browserRequests.length +
    history.codexEvents.length +
    (history.codexActivities?.length ?? 0) +
    history.gitWorkflowEvents.length +
    history.githubActionsEvents.length;
  return (
    <article className="read-only-archive" aria-label="Read-only room archive">
      <header>
        <strong>{archive.roomName}</strong>
        <span>Read-only · exported {new Date(archive.exportedAt).toLocaleString()}</span>
      </header>
      {archive.teamName && <small>Team: {archive.teamName}</small>}
      <p>
        {history.messages.length} messages · {activityCount} normalized activity records ·{" "}
        {history.terminalSnapshots.length} completed terminal transcripts
      </p>
      <div className="archive-message-list">
        {history.messages.map((chat) => (
          <div key={chat.id}>
            <strong>{chat.author}</strong>
            <span>{chat.body}</span>
          </div>
        ))}
      </div>
      <details>
        <summary>Intentionally omitted</summary>
        <ul>
          {archive.omissions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Archive operation failed.";
}

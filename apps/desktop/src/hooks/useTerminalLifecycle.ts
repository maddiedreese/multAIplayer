import { useEffect } from "react";
import { listTerminals, readTerminal, type TerminalSnapshot } from "../lib/localBackend";
import { mergeTerminalSnapshots } from "../lib/terminalState";
import { useAppStore } from "../store/appStore";

interface UseTerminalLifecycleOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedTerminalId: string | null;
  selectedTerminalRunning: boolean | undefined;
  clearTerminalSnapshots: () => void;
  clearTerminalSnapshotsForRoom: (roomId: string) => void;
  syncTerminalSnapshotsForRoom: (roomId: string, snapshots: TerminalSnapshot[]) => void;
  upsertTerminalSnapshot: (snapshot: TerminalSnapshot) => void;
  setTerminalErrorForRoom: (roomId: string, message: string | null) => void;
}

export function useTerminalLifecycle({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedTerminalId,
  selectedTerminalRunning,
  clearTerminalSnapshots,
  clearTerminalSnapshotsForRoom,
  syncTerminalSnapshotsForRoom,
  upsertTerminalSnapshot,
  setTerminalErrorForRoom
}: UseTerminalLifecycleOptions) {
  const setSelectedTerminalIdForRoom = useAppStore((state) => state.setSelectedTerminalIdForRoom);

  useEffect(() => {
    if (!hasSelectedRoom) {
      clearTerminalSnapshots();
      return;
    }
    const roomId = selectedRoomId;
    if (!canReadLocalWorkspace) {
      clearTerminalSnapshotsForRoom(roomId);
      setSelectedTerminalIdForRoom(roomId, null);
      return;
    }
    let cancelled = false;
    listTerminals(roomId)
      .then((snapshots) => {
        if (cancelled) return;
        const mergedSnapshots = mergeTerminalSnapshots(
          useAppStore.getState().terminals.filter((terminal) => terminal.roomId === roomId),
          snapshots
        );
        syncTerminalSnapshotsForRoom(roomId, mergedSnapshots);
        const currentTerminalId = useAppStore.getState().terminalRuntimeByRoom[roomId]?.selectedTerminalId ?? null;
        const nextTerminalId = currentTerminalId && mergedSnapshots.some((terminal) => terminal.id === currentTerminalId)
          ? currentTerminalId
          : mergedSnapshots[0]?.id ?? null;
        setSelectedTerminalIdForRoom(roomId, nextTerminalId);
      })
      .catch((error) => {
        if (!cancelled) setTerminalErrorForRoom(roomId, String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, clearTerminalSnapshots, clearTerminalSnapshotsForRoom, hasSelectedRoom, selectedRoomId, setSelectedTerminalIdForRoom, syncTerminalSnapshotsForRoom]);

  useEffect(() => {
    if (!canReadLocalWorkspace || !selectedTerminalId || !selectedTerminalRunning) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      readTerminal(selectedTerminalId)
        .then((snapshot) => {
          if (cancelled) return;
          upsertTerminalSnapshot(snapshot);
        })
        .catch((error) => {
          if (!cancelled && hasSelectedRoom) setTerminalErrorForRoom(selectedRoomId, String(error));
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasSelectedRoom, selectedRoomId, selectedTerminalRunning, selectedTerminalId, upsertTerminalSnapshot]);
}

import { useEffect } from "react";
import { listTerminals, readTerminal } from "../lib/platform/localBackend";
import { mergeTerminalSnapshots } from "../lib/terminal/terminalState";
import { useAppStore } from "../store/appStore";

interface UseTerminalLifecycleOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedTerminalId: string | null;
  selectedTerminalRunning: boolean | undefined;
}

export function useTerminalLifecycle({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedTerminalId,
  selectedTerminalRunning
}: UseTerminalLifecycleOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) {
      useAppStore.getState().clearTerminalSnapshots();
      return;
    }
    const roomId = selectedRoomId;
    if (!canReadLocalWorkspace) {
      const store = useAppStore.getState();
      store.clearTerminalSnapshotsForRoom(roomId);
      store.setSelectedTerminalIdForRoom(roomId, null);
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
        useAppStore.getState().syncTerminalSnapshotsForRoom(roomId, mergedSnapshots);
        const currentTerminalId = useAppStore.getState().terminalRuntimeByRoom[roomId]?.selectedTerminalId ?? null;
        const nextTerminalId =
          currentTerminalId && mergedSnapshots.some((terminal) => terminal.id === currentTerminalId)
            ? currentTerminalId
            : (mergedSnapshots[0]?.id ?? null);
        useAppStore.getState().setSelectedTerminalIdForRoom(roomId, nextTerminalId);
      })
      .catch((error) => {
        if (!cancelled) useAppStore.getState().setTerminalErrorForRoom(roomId, String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId]);

  useEffect(() => {
    if (!canReadLocalWorkspace || !selectedTerminalId || !selectedTerminalRunning) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      readTerminal(selectedTerminalId)
        .then((snapshot) => {
          if (cancelled) return;
          useAppStore.getState().upsertTerminalSnapshot(snapshot);
        })
        .catch((error) => {
          if (!cancelled && hasSelectedRoom) {
            useAppStore.getState().setTerminalErrorForRoom(selectedRoomId, String(error));
          }
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedTerminalRunning, selectedTerminalId]);
}

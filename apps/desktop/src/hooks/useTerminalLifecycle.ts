import { useEffect, type Dispatch, type SetStateAction } from "react";
import { listTerminals, readTerminal, type TerminalSnapshot } from "../lib/localBackend";
import { mergeTerminalSnapshots, replaceRoomTerminalSnapshots, upsertTerminal } from "../lib/terminalState";
import { useAppStore } from "../store/appStore";

interface UseTerminalLifecycleOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedTerminalId: string | null;
  selectedTerminalRunning: boolean | undefined;
  setTerminals: Dispatch<SetStateAction<TerminalSnapshot[]>>;
  setTerminalErrorForRoom: (roomId: string, message: string | null) => void;
}

export function useTerminalLifecycle({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedTerminalId,
  selectedTerminalRunning,
  setTerminals,
  setTerminalErrorForRoom
}: UseTerminalLifecycleOptions) {
  const setSelectedTerminalIdForRoom = useAppStore((state) => state.setSelectedTerminalIdForRoom);

  useEffect(() => {
    if (!hasSelectedRoom) {
      setTerminals([]);
      return;
    }
    const roomId = selectedRoomId;
    if (!canReadLocalWorkspace) {
      setTerminals((current) => replaceRoomTerminalSnapshots(current, roomId, []));
      setSelectedTerminalIdForRoom(roomId, null);
      return;
    }
    let cancelled = false;
    listTerminals(roomId)
      .then((snapshots) => {
        if (cancelled) return;
        let mergedSnapshots: TerminalSnapshot[] = [];
        setTerminals((current) => {
          mergedSnapshots = mergeTerminalSnapshots(
            current.filter((terminal) => terminal.roomId === roomId),
            snapshots
          );
          return replaceRoomTerminalSnapshots(current, roomId, mergedSnapshots);
        });
        const currentTerminalId = useAppStore.getState().selectedTerminalIdsByRoom[roomId] ?? null;
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
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, setSelectedTerminalIdForRoom]);

  useEffect(() => {
    if (!canReadLocalWorkspace || !selectedTerminalId || !selectedTerminalRunning) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      readTerminal(selectedTerminalId)
        .then((snapshot) => {
          if (cancelled) return;
          setTerminals((current) => upsertTerminal(current, snapshot));
        })
        .catch((error) => {
          if (!cancelled && hasSelectedRoom) setTerminalErrorForRoom(selectedRoomId, String(error));
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasSelectedRoom, selectedRoomId, selectedTerminalRunning, selectedTerminalId]);
}

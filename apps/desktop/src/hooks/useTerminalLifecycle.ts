import { useEffect, type Dispatch, type SetStateAction } from "react";
import { listTerminals, readTerminal, type TerminalSnapshot } from "../lib/localBackend";
import { omitRecordKey } from "../lib/setUtils";
import { mergeTerminalSnapshots, replaceRoomTerminalSnapshots, upsertTerminal } from "../lib/terminalState";

interface UseTerminalLifecycleOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedTerminalId: string | null;
  selectedTerminalRunning: boolean | undefined;
  setTerminals: Dispatch<SetStateAction<TerminalSnapshot[]>>;
  setSelectedTerminalIdsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setSelectedTerminalIdForRoom: (roomId: string, terminalId: string | null) => void;
  setTerminalErrorForRoom: (roomId: string, message: string | null) => void;
}

export function useTerminalLifecycle({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedTerminalId,
  selectedTerminalRunning,
  setTerminals,
  setSelectedTerminalIdsByRoom,
  setSelectedTerminalIdForRoom,
  setTerminalErrorForRoom
}: UseTerminalLifecycleOptions) {
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
        setSelectedTerminalIdsByRoom((current) => {
          const currentTerminalId = current[roomId] ?? null;
          const nextTerminalId = currentTerminalId && mergedSnapshots.some((terminal) => terminal.id === currentTerminalId)
            ? currentTerminalId
            : mergedSnapshots[0]?.id ?? null;
          return nextTerminalId ? { ...current, [roomId]: nextTerminalId } : omitRecordKey(current, roomId);
        });
      })
      .catch((error) => {
        if (!cancelled) setTerminalErrorForRoom(roomId, String(error));
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

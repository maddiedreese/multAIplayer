import { useEffect } from "react";

interface LatestRef<T> {
  current: T;
}

interface UseTerminalAutoOpenOptions {
  inspectorTab: string;
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  isSelectedRoomLocked: boolean;
  terminalBusy: boolean;
  roomTerminalCount: number;
  selectedRoomId: string | null;
  terminalAutoOpenedRoomsRef: LatestRef<Set<string>>;
  openInteractiveTerminal: (options?: { reuseExisting?: boolean; quiet?: boolean }) => Promise<void>;
}

export function useTerminalAutoOpen({
  inspectorTab,
  hasSelectedRoom,
  isActiveHost,
  canReadLocalWorkspace,
  isSelectedRoomLocked,
  terminalBusy,
  roomTerminalCount,
  selectedRoomId,
  terminalAutoOpenedRoomsRef,
  openInteractiveTerminal
}: UseTerminalAutoOpenOptions) {
  useEffect(() => {
    if (
      inspectorTab !== "terminal" ||
      !hasSelectedRoom ||
      !selectedRoomId ||
      !isActiveHost ||
      !canReadLocalWorkspace ||
      isSelectedRoomLocked ||
      terminalBusy ||
      roomTerminalCount > 0 ||
      terminalAutoOpenedRoomsRef.current.has(selectedRoomId)
    ) {
      return;
    }

    terminalAutoOpenedRoomsRef.current.add(selectedRoomId);
    void openInteractiveTerminal({ reuseExisting: true, quiet: true });
  }, [
    canReadLocalWorkspace,
    hasSelectedRoom,
    inspectorTab,
    isActiveHost,
    isSelectedRoomLocked,
    roomTerminalCount,
    selectedRoomId,
    openInteractiveTerminal,
    terminalAutoOpenedRoomsRef,
    terminalBusy
  ]);
}

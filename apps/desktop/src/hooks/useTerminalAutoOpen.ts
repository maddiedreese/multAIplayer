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
  selectedRoomProjectPath: string;
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
  selectedRoomProjectPath,
  terminalAutoOpenedRoomsRef,
  openInteractiveTerminal
}: UseTerminalAutoOpenOptions) {
  useEffect(() => {
    const terminalAutoOpenKey = `${selectedRoomId ?? ""}\u0000${selectedRoomProjectPath}`;
    if (
      inspectorTab !== "terminal" ||
      !hasSelectedRoom ||
      !selectedRoomId ||
      !isActiveHost ||
      !canReadLocalWorkspace ||
      isSelectedRoomLocked ||
      terminalBusy ||
      roomTerminalCount > 0 ||
      terminalAutoOpenedRoomsRef.current.has(terminalAutoOpenKey)
    ) {
      return;
    }

    terminalAutoOpenedRoomsRef.current.add(terminalAutoOpenKey);
    void openInteractiveTerminal({ reuseExisting: true, quiet: true });
  }, [
    canReadLocalWorkspace,
    hasSelectedRoom,
    inspectorTab,
    isActiveHost,
    isSelectedRoomLocked,
    roomTerminalCount,
    selectedRoomId,
    selectedRoomProjectPath,
    openInteractiveTerminal,
    terminalAutoOpenedRoomsRef,
    terminalBusy
  ]);
}

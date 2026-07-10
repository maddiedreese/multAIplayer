import type { TerminalCommandRequest } from "../types";
import { useAppStore } from "../store/appStore";

export function createTerminalPanelActions({
  selectedRoomId,
  terminalRequests,
  copyTerminalMarkdown,
  openInteractiveTerminal,
  approveTerminalRequest,
  denyTerminalRequest,
  sendTerminalData,
  restartSelectedTerminal,
  stopSelectedTerminal
}: {
  selectedRoomId: string;
  terminalRequests: TerminalCommandRequest[];
  copyTerminalMarkdown: () => void;
  openInteractiveTerminal: (options?: { reuseExisting?: boolean; quiet?: boolean }) => void;
  approveTerminalRequest: (request: TerminalCommandRequest) => void;
  denyTerminalRequest: (requestId: string) => void;
  sendTerminalData: (input: string) => void;
  restartSelectedTerminal: () => void;
  stopSelectedTerminal: () => void;
}) {
  function onApproveTerminalRequest(requestId: string) {
    const request = terminalRequests.find((item) => item.id === requestId);
    if (request) approveTerminalRequest(request);
  }

  return {
    onCopyMarkdown: copyTerminalMarkdown,
    onOpenInteractiveTerminal: () => openInteractiveTerminal({ reuseExisting: false }),
    onApproveTerminalRequest,
    onDenyTerminalRequest: denyTerminalRequest,
    onSelectTerminal: (terminalId: string) =>
      useAppStore.getState().setSelectedTerminalIdForRoom(selectedRoomId, terminalId),
    onSendTerminalData: (input: string) => sendTerminalData(input),
    onRestartTerminal: () => restartSelectedTerminal(),
    onStopTerminal: () => stopSelectedTerminal()
  };
}

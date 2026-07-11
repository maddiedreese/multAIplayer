import type { TerminalCommandRequest } from "../types";
import { useAppStore } from "../store/appStore";

export function createTerminalPanelActions({
  copyTerminalMarkdown,
  openInteractiveTerminal,
  approveTerminalRequest,
  denyTerminalRequest,
  sendTerminalData,
  restartSelectedTerminal,
  stopSelectedTerminal,
  revokeExactCommandGrants
}: {
  copyTerminalMarkdown: () => void;
  openInteractiveTerminal: (options?: { reuseExisting?: boolean; quiet?: boolean }) => void;
  approveTerminalRequest: (request: TerminalCommandRequest) => void;
  denyTerminalRequest: (requestId: string) => void;
  sendTerminalData: (input: string) => void;
  restartSelectedTerminal: () => void;
  stopSelectedTerminal: () => void;
  revokeExactCommandGrants: () => void;
}) {
  function onApproveTerminalRequest(requestId: string) {
    const state = useAppStore.getState();
    const request = (state.terminalRuntimeByRoom[state.selectedRoomId]?.requests ?? []).find(
      (item) => item.id === requestId
    );
    if (request) approveTerminalRequest(request);
  }

  return {
    onCopyMarkdown: copyTerminalMarkdown,
    onOpenInteractiveTerminal: () => openInteractiveTerminal({ reuseExisting: false }),
    onApproveTerminalRequest,
    onDenyTerminalRequest: denyTerminalRequest,
    onSelectTerminal: (terminalId: string) => {
      const state = useAppStore.getState();
      state.setSelectedTerminalIdForRoom(state.selectedRoomId, terminalId);
    },
    onSendTerminalData: (input: string) => sendTerminalData(input),
    onRestartTerminal: () => restartSelectedTerminal(),
    onStopTerminal: () => stopSelectedTerminal(),
    onRevokeExactCommandGrants: () => revokeExactCommandGrants()
  };
}

import type { TerminalCommandRequest } from "../types";

export function useTerminalPanelActions({
  selectedRoomId,
  terminalRequests,
  copyTerminalMarkdown,
  runApprovedTerminalCheck,
  openInteractiveTerminal,
  setTerminalNameForRoom,
  setTerminalCommandForRoom,
  startNamedTerminal,
  requestTerminalCommand,
  approveTerminalRequest,
  denyTerminalRequest,
  setSelectedTerminalIdForRoom,
  setTerminalInputForRoom,
  sendTerminalInput,
  restartSelectedTerminal,
  stopSelectedTerminal
}: {
  selectedRoomId: string;
  terminalRequests: TerminalCommandRequest[];
  copyTerminalMarkdown: () => void;
  runApprovedTerminalCheck: () => void;
  openInteractiveTerminal: (options?: { reuseExisting?: boolean; quiet?: boolean }) => void;
  setTerminalNameForRoom: (roomId: string, name: string) => void;
  setTerminalCommandForRoom: (roomId: string, command: string) => void;
  startNamedTerminal: () => void;
  requestTerminalCommand: () => void;
  approveTerminalRequest: (request: TerminalCommandRequest) => void;
  denyTerminalRequest: (requestId: string) => void;
  setSelectedTerminalIdForRoom: (roomId: string, terminalId: string | null) => void;
  setTerminalInputForRoom: (roomId: string, input: string) => void;
  sendTerminalInput: () => void;
  restartSelectedTerminal: () => void;
  stopSelectedTerminal: () => void;
}) {
  function onApproveTerminalRequest(requestId: string) {
    const request = terminalRequests.find((item) => item.id === requestId);
    if (request) approveTerminalRequest(request);
  }

  return {
    onCopyMarkdown: copyTerminalMarkdown,
    onRunGitStatus: runApprovedTerminalCheck,
    onOpenInteractiveTerminal: () => openInteractiveTerminal({ reuseExisting: false }),
    onTerminalNameChange: (name: string) => setTerminalNameForRoom(selectedRoomId, name),
    onTerminalCommandChange: (command: string) => setTerminalCommandForRoom(selectedRoomId, command),
    onStartTerminal: () => startNamedTerminal(),
    onRequestTerminalCommand: () => requestTerminalCommand(),
    onApproveTerminalRequest,
    onDenyTerminalRequest: denyTerminalRequest,
    onSelectTerminal: (terminalId: string) => setSelectedTerminalIdForRoom(selectedRoomId, terminalId),
    onTerminalInputChange: (input: string) => setTerminalInputForRoom(selectedRoomId, input),
    onSendTerminalInput: () => sendTerminalInput(),
    onRestartTerminal: () => restartSelectedTerminal(),
    onStopTerminal: () => stopSelectedTerminal()
  };
}
